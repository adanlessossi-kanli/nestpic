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

function makeSession(sessionId: string, userId: string) {
  return Object.assign(
    { sessionId, userId, email: 'u@example.com', name: 'User' },
    {
      save: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    }
  )
}

async function callMediaGet(mediaId: string, s3Key: string, contentType: string) {
  const sessionId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  mockGetIronSession.mockResolvedValue(makeSession(sessionId, userId))
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // getValidSession
    .mockResolvedValueOnce({
      rows: [{
        id: mediaId,
        uploader_id: userId,
        s3_key: s3Key,
        thumbnail_key: `thumbnails/${mediaId}.jpg`,
        content_type: contentType,
        file_size: 1024,
        status: 'active',
        uploaded_at: new Date(),
        uploader_name: 'Test User',
      }],
    })

  const { NextRequest } = await import('next/server')
  const { GET } = await import('@/app/api/media/[id]/route')
  const req = new NextRequest(`http://localhost/api/media/${mediaId}`)
  return GET(req, { params: Promise.resolve({ id: mediaId }) })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('URL signing property tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Feature: nestpic-app, Property 11: Signed CDN URLs expire within 1 hour
  it('Property 11: generateSignedGetUrl for media view is called with expiresIn <= 3600', async () => {
    // Validates: Requirements 3.3, 5.1
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.string({ minLength: 5, maxLength: 100 }),
        fc.constantFrom('image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'),
        async (mediaId, s3Key, contentType) => {
          vi.clearAllMocks()

          mockGenerateSignedGetUrl.mockImplementation((_key: string, expiresIn: number) =>
            Promise.resolve(
              `https://cdn.example.com/${_key}?Expires=${Math.floor(Date.now() / 1000) + expiresIn}`
            )
          )

          const res = await callMediaGet(mediaId, s3Key, contentType)
          expect(res.status).toBe(200)

          expect(mockGenerateSignedGetUrl).toHaveBeenCalled()
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

  // Feature: nestpic-app, Property 24: Signed URLs are scoped to a specific object key
  it('Property 24: signed URL is generated for the exact s3_key of the requested media', async () => {
    // Validates: Requirements 9.6
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.string({ minLength: 5, maxLength: 100 }).map((s) => `originals/${s}`),
        fc.constantFrom('image/jpeg', 'image/png', 'video/mp4'),
        async (mediaId, s3Key, contentType) => {
          vi.clearAllMocks()

          mockGenerateSignedGetUrl.mockImplementation((key: string, expiresIn: number) =>
            Promise.resolve(
              `https://cdn.example.com/${key}?Expires=${Math.floor(Date.now() / 1000) + expiresIn}`
            )
          )

          const res = await callMediaGet(mediaId, s3Key, contentType)
          expect(res.status).toBe(200)

          const json = await res.json()

          // The URL must contain the exact s3Key
          expect(json.mediaUrl).toContain(s3Key)

          // generateSignedGetUrl must have been called with the exact s3Key
          const calledKeys = mockGenerateSignedGetUrl.mock.calls.map((c) => c[0] as string)
          expect(calledKeys).toContain(s3Key)

          // The URL must NOT contain any other key (no cross-key access)
          const otherKey = `originals/other-${crypto.randomUUID()}`
          expect(json.mediaUrl).not.toContain(otherKey)
        }
      ),
      { numRuns: 100 }
    )
  })
})
