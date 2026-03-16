import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

vi.mock('server-only', () => ({}))

const mockQuery = vi.fn()
vi.mock('@/lib/db', () => ({ query: mockQuery, default: {} }))

const mockGetIronSession = vi.fn()
vi.mock('iron-session', () => ({ getIronSession: mockGetIronSession }))
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }))

const mockGenerateSignedGetUrl = vi.fn()
const mockGetObjectStore = vi.fn().mockResolvedValue({
  generateSignedGetUrl: mockGenerateSignedGetUrl,
  generatePresignedPutUrl: vi.fn(),
  deleteObject: vi.fn(),
  headObject: vi.fn(),
})
vi.mock('@/lib/objectStore', () => ({ getObjectStore: mockGetObjectStore }))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Record<string, unknown> = {}) {
  return Object.assign({ ...overrides }, {
    save: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  })
}

function makeMediaRow(uploadedAt: Date, id = crypto.randomUUID()) {
  return {
    id,
    thumbnail_key: `thumbnails/${id}.jpg`,
    content_type: 'image/jpeg',
    s3_key: `originals/${id}.jpg`,
    uploaded_at: uploadedAt,
    uploader_name: 'Test User',
  }
}

async function callFeedGet(mediaRows: ReturnType<typeof makeMediaRow>[]) {
  const sessionId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const session = makeSession({ sessionId, userId, email: 'u@example.com', name: 'User' })
  mockGetIronSession.mockResolvedValue(session)
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // getValidSession DB check
    .mockResolvedValueOnce({ rows: mediaRows })            // feed query

  const { NextRequest } = await import('next/server')
  const { GET } = await import('@/app/api/feed/route')
  const req = new NextRequest('http://localhost/api/feed')
  return GET(req)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Feed property tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Feature: nestpic-app, Property 9: Media listings are in reverse chronological order
  it('Property 9: feed items are in reverse chronological order', async () => {
    // Validates: Requirements 3.1
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 30 }).chain((n) =>
          fc.array(fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }), {
            minLength: n,
            maxLength: n,
          }).map((dates) => dates.sort((a, b) => b.getTime() - a.getTime()))
        ),
        async (dates) => {
          vi.clearAllMocks()

          mockGenerateSignedGetUrl.mockImplementation((key: string) =>
            Promise.resolve(`https://cdn.example.com/signed/${key}`)
          )

          const mediaRows = dates.map((d) => makeMediaRow(d))
          const res = await callFeedGet(mediaRows)
          const json = await res.json()

          expect(res.status).toBe(200)
          const items: { uploadedAt: string }[] = json.items
          for (let i = 0; i < items.length - 1; i++) {
            const curr = new Date(items[i].uploadedAt).getTime()
            const next = new Date(items[i + 1].uploadedAt).getTime()
            expect(curr).toBeGreaterThanOrEqual(next)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: nestpic-app, Property 10: Feed and album media items include required fields
  it('Property 10: each feed item includes thumbnailUrl, uploaderName, and uploadedAt', async () => {
    // Validates: Requirements 3.2
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 30 }).chain((n) =>
          fc.array(fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }), {
            minLength: n,
            maxLength: n,
          })
        ),
        async (dates) => {
          vi.clearAllMocks()

          mockGenerateSignedGetUrl.mockImplementation((key: string) =>
            Promise.resolve(`https://cdn.example.com/signed/${key}`)
          )

          const mediaRows = dates.map((d) => makeMediaRow(d))
          const res = await callFeedGet(mediaRows)
          const json = await res.json()

          expect(res.status).toBe(200)
          const items: Record<string, unknown>[] = json.items
          for (const item of items) {
            // thumbnailUrl must be a string or null
            expect(
              item.thumbnailUrl === null || typeof item.thumbnailUrl === 'string'
            ).toBe(true)
            // uploaderName must be a string
            expect(typeof item.uploaderName).toBe('string')
            // uploadedAt must be a string
            expect(typeof item.uploadedAt).toBe('string')
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: nestpic-app, Property 11: Signed CDN URLs expire within 1 hour
  it('Property 11: generateSignedGetUrl is called with expiresIn <= 3600', async () => {
    // Validates: Requirements 3.3
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (n) => {
          vi.clearAllMocks()

          mockGenerateSignedGetUrl.mockImplementation((_key: string, expiresIn: number) =>
            Promise.resolve(
              `https://cdn.example.com/signed?Expires=${Math.floor(Date.now() / 1000) + expiresIn}`
            )
          )

          const dates = Array.from({ length: n }, (_, i) =>
            new Date(Date.now() - i * 1000)
          )
          const mediaRows = dates.map((d) => makeMediaRow(d))
          await callFeedGet(mediaRows)

          for (const call of mockGenerateSignedGetUrl.mock.calls) {
            const expiresIn = call[1] as number
            expect(expiresIn).toBeLessThanOrEqual(3600)
            expect(expiresIn).toBeGreaterThan(0)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: nestpic-app, Property 12: Feed pagination returns at most 30 items per page
  it('Property 12: feed returns at most 30 items per page', async () => {
    // Validates: Requirements 3.4
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 31, max: 100 }),
        async (n) => {
          vi.clearAllMocks()

          mockGenerateSignedGetUrl.mockImplementation((key: string) =>
            Promise.resolve(`https://cdn.example.com/signed/${key}`)
          )

          // The route fetches PAGE_SIZE + 1 (31) rows to detect next page.
          // We simulate the DB returning n rows (> 30), so the route slices to 30.
          const dates = Array.from({ length: n }, (_, i) =>
            new Date(Date.now() - i * 1000)
          )
          const mediaRows = dates.map((d) => makeMediaRow(d))
          const res = await callFeedGet(mediaRows)
          const json = await res.json()

          expect(res.status).toBe(200)
          expect(json.items.length).toBeLessThanOrEqual(30)
        }
      ),
      { numRuns: 100 }
    )
  })
})
