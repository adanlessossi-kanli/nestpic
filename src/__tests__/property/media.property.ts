import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

vi.mock('server-only', () => ({}))

const mockQuery = vi.fn()
vi.mock('@/lib/db', () => ({ query: mockQuery, default: {} }))

const mockGetIronSession = vi.fn()
vi.mock('iron-session', () => ({ getIronSession: mockGetIronSession }))
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }))

const mockDeleteObject = vi.fn().mockResolvedValue(undefined)
const mockGetObjectStore = vi.fn().mockResolvedValue({
  generateSignedGetUrl: vi.fn(),
  generatePresignedPutUrl: vi.fn(),
  deleteObject: mockDeleteObject,
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

describe('Media property tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Feature: nestpic-app, Property 17: Media deletion removes all traces
  it('Property 17: media deletion removes all traces', async () => {
    // Validates: Requirements 6.2, 6.4
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        async (mediaId, userId, sessionId) => {
          vi.clearAllMocks()

          makeAuthSession(userId, sessionId)

          // SELECT media record
          mockQuery.mockResolvedValueOnce({
            rows: [{
              id: mediaId,
              uploader_id: userId,
              s3_key: 's3/key',
              thumbnail_key: 'thumbnails/key',
              status: 'active',
            }],
          })
          // DELETE album_media
          mockQuery.mockResolvedValueOnce({ rows: [] })
          // DELETE media
          mockQuery.mockResolvedValueOnce({ rows: [] })

          const { NextRequest } = await import('next/server')
          const { DELETE } = await import('@/app/api/media/[id]/route')

          const req = new NextRequest(`http://localhost/api/media/${mediaId}`, {
            method: 'DELETE',
          })
          const res = await DELETE(req, { params: Promise.resolve({ id: mediaId }) })
          const json = await res.json()

          expect(res.status).toBe(200)
          expect(json.deleted).toBe(true)

          // s3_key and thumbnail_key must both be deleted from object store
          const deleteObjectCalls = mockDeleteObject.mock.calls.map((c: unknown[]) => c[0])
          expect(deleteObjectCalls).toContain('s3/key')
          expect(deleteObjectCalls).toContain('thumbnails/key')

          // album_media and media rows must be deleted from DB
          const queryStrings = mockQuery.mock.calls.map((c: unknown[]) => c[0] as string)
          expect(queryStrings.some((q) => q.includes('album_media'))).toBe(true)
          expect(queryStrings.some((q) => q.includes('DELETE FROM media'))).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: nestpic-app, Property 18: Non-owner cannot delete media
  it('Property 18: non-owner cannot delete media', async () => {
    // Validates: Requirements 6.3
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b),
        fc.uuid(),
        async (mediaId, [userId, ownerId], sessionId) => {
          vi.clearAllMocks()

          makeAuthSession(userId, sessionId)

          // SELECT media record — owned by ownerId, not userId
          mockQuery.mockResolvedValueOnce({
            rows: [{
              id: mediaId,
              uploader_id: ownerId,
              s3_key: 's3/key',
              thumbnail_key: null,
              status: 'active',
            }],
          })

          const { NextRequest } = await import('next/server')
          const { DELETE } = await import('@/app/api/media/[id]/route')

          const req = new NextRequest(`http://localhost/api/media/${mediaId}`, {
            method: 'DELETE',
          })
          const res = await DELETE(req, { params: Promise.resolve({ id: mediaId }) })
          const json = await res.json()

          expect(res.status).toBe(403)
          expect(json.error.code).toBe('FORBIDDEN')
          expect(mockDeleteObject).not.toHaveBeenCalled()
        }
      ),
      { numRuns: 100 }
    )
  })
})
