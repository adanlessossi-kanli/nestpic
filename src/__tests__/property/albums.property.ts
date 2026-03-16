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

function makeAuthSession(userId = crypto.randomUUID(), sessionId = crypto.randomUUID()) {
  const session = makeSession({ sessionId, userId, email: 'user@example.com', name: 'User' })
  mockGetIronSession.mockResolvedValue(session)
  // getValidSession DB check
  mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] })
  return { userId, sessionId }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Album property tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Feature: nestpic-app, Property 13: Album creation persists correct metadata
  it('Property 13: album creation persists correct metadata', async () => {
    // Validates: Requirements 4.1
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.uuid(),
        fc.uuid(),
        async (name, userId, sessionId) => {
          vi.clearAllMocks()

          makeAuthSession(userId, sessionId)

          const albumId = crypto.randomUUID()
          const createdAt = new Date()
          mockQuery.mockResolvedValueOnce({
            rows: [{ id: albumId, name, created_by: userId, created_at: createdAt }],
          })

          const { NextRequest } = await import('next/server')
          const { POST } = await import('@/app/api/albums/route')
          const req = new NextRequest('http://localhost/api/albums', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          })
          const res = await POST(req)
          const json = await res.json()

          expect(res.status).toBe(200)
          expect(json.data.name).toBe(name)
          expect(json.data.created_by).toBe(userId)
          expect(json.data.created_at).toBeDefined()
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: nestpic-app, Property 14: Album name validation rejects invalid names
  it('Property 14: album name validation rejects invalid names', async () => {
    // Validates: Requirements 4.2
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constant(''), fc.string({ minLength: 101, maxLength: 200 })),
        fc.uuid(),
        fc.uuid(),
        async (name, userId, sessionId) => {
          vi.clearAllMocks()

          makeAuthSession(userId, sessionId)

          const { NextRequest } = await import('next/server')
          const { POST } = await import('@/app/api/albums/route')
          const req = new NextRequest('http://localhost/api/albums', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          })
          const res = await POST(req)
          const json = await res.json()

          expect(res.status).toBe(400)
          expect(json.error.code).toBe('VALIDATION_ERROR')
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: nestpic-app, Property 15: Media can belong to multiple albums simultaneously
  it('Property 15: media can belong to multiple albums simultaneously', async () => {
    // Validates: Requirements 4.3, 4.4
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        async (numAlbums, mediaId, userId, sessionId) => {
          vi.clearAllMocks()

          const albumIds = Array.from({ length: numAlbums }, () => crypto.randomUUID())

          // For each album, we call POST /api/albums/:id/media
          // Each call needs: auth session check + album existence check + INSERT
          for (const albumId of albumIds) {
            makeAuthSession(userId, sessionId)
            // Album exists check
            mockQuery.mockResolvedValueOnce({ rows: [{ id: albumId }] })
            // INSERT album_media
            mockQuery.mockResolvedValueOnce({ rows: [] })
          }

          const { NextRequest } = await import('next/server')
          const { POST } = await import('@/app/api/albums/[id]/media/route')

          const results: { status: number; albumId: string }[] = []
          for (const albumId of albumIds) {
            const req = new NextRequest(`http://localhost/api/albums/${albumId}/media`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ mediaId }),
            })
            const res = await POST(req, { params: Promise.resolve({ id: albumId }) })
            const json = await res.json()
            results.push({ status: res.status, albumId: json.albumId })
          }

          // All insertions should succeed
          for (let i = 0; i < numAlbums; i++) {
            expect(results[i].status).toBe(200)
            expect(results[i].albumId).toBe(albumIds[i])
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: nestpic-app, Property 16: Album deletion preserves media
  it('Property 16: album deletion preserves media records', async () => {
    // Validates: Requirements 4.6
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        async (albumId, userId, sessionId) => {
          vi.clearAllMocks()

          makeAuthSession(userId, sessionId)
          // Album exists check
          mockQuery.mockResolvedValueOnce({ rows: [{ id: albumId }] })
          // DELETE album_media
          mockQuery.mockResolvedValueOnce({ rows: [] })
          // DELETE albums
          mockQuery.mockResolvedValueOnce({ rows: [] })

          const { NextRequest } = await import('next/server')
          const { DELETE } = await import('@/app/api/albums/[id]/route')
          const req = new NextRequest(`http://localhost/api/albums/${albumId}`, {
            method: 'DELETE',
          })
          const res = await DELETE(req, { params: Promise.resolve({ id: albumId }) })
          const json = await res.json()

          expect(res.status).toBe(200)
          expect(json.deleted).toBe(true)

          // Verify DELETE was called for album_media and albums, but NOT for media table
          const deleteCalls = mockQuery.mock.calls.filter((call: unknown[]) =>
            typeof call[0] === 'string' && call[0].trim().toUpperCase().startsWith('DELETE')
          )
          // Should have exactly 2 DELETE calls: album_media and albums
          expect(deleteCalls.length).toBe(2)

          const deleteTargets = deleteCalls.map((call: unknown[]) => (call[0] as string).toLowerCase())
          expect(deleteTargets.some((q: string) => q.includes('album_media'))).toBe(true)
          expect(deleteTargets.some((q: string) => q.includes('albums'))).toBe(true)
          // Media table must NOT be deleted
          expect(deleteTargets.some((q: string) => q.includes('from media'))).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})
