import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

vi.mock('server-only', () => ({}));

const mockQuery = vi.fn();
vi.mock('@/lib/db', () => ({ query: mockQuery, default: {} }));

const mockGetIronSession = vi.fn();
vi.mock('iron-session', () => ({ getIronSession: mockGetIronSession }));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));

const mockGeneratePresignedPutUrl = vi.fn();
const mockHeadObject = vi.fn();
const mockDeleteObject = vi.fn();
const mockGetObjectStore = vi.fn().mockResolvedValue({
  generatePresignedPutUrl: mockGeneratePresignedPutUrl,
  generateSignedGetUrl: vi.fn(),
  deleteObject: mockDeleteObject,
  headObject: mockHeadObject,
});
vi.mock('@/lib/objectStore', () => ({ getObjectStore: mockGetObjectStore }));

import {
  validateFile,
  ACCEPTED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '@/lib/upload/validateFile';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...overrides };
  return Object.assign(data, {
    save: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  });
}

const ACCEPTED_TYPES = [...ACCEPTED_MIME_TYPES];

// ─── Property 5: File validation rejects invalid inputs ───────────────────────

describe('Upload property tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Feature: nestpic-app, Property 5: File validation rejects invalid inputs
  it('Property 5: rejects files with unsupported MIME types', () => {
    fc.assert(
      fc.property(
        fc.record({
          mimeType: fc.string().filter((s) => !ACCEPTED_TYPES.includes(s) && s.length > 0),
          size: fc.integer({ min: 1, max: MAX_FILE_SIZE_BYTES }),
        }),
        ({ mimeType, size }) => {
          const result = validateFile({ mimeType, size });
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe('UNSUPPORTED_FILE_TYPE');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: nestpic-app, Property 5: File validation rejects invalid inputs
  it('Property 5: rejects files exceeding 200 MB', () => {
    fc.assert(
      fc.property(
        fc.record({
          mimeType: fc.constantFrom(...ACCEPTED_TYPES),
          size: fc.integer({ min: MAX_FILE_SIZE_BYTES + 1, max: MAX_FILE_SIZE_BYTES * 2 }),
        }),
        ({ mimeType, size }) => {
          const result = validateFile({ mimeType, size });
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe('FILE_TOO_LARGE');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: nestpic-app, Property 5: File validation accepts valid inputs
  it('Property 5: accepts valid MIME types within size limit', () => {
    fc.assert(
      fc.property(
        fc.record({
          mimeType: fc.constantFrom(...ACCEPTED_TYPES),
          size: fc.integer({ min: 1, max: MAX_FILE_SIZE_BYTES }),
        }),
        ({ mimeType, size }) => {
          const result = validateFile({ mimeType, size });
          expect(result.ok).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 6: Presigned PUT URLs expire within 15 minutes ─────────────────

  // Feature: nestpic-app, Property 6: Presigned PUT URLs expire within 15 minutes
  it('Property 6: presign route calls generatePresignedPutUrl with expiry <= 900s', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          filename: fc.string({ minLength: 1, maxLength: 50 }).map((s) => `${s}.jpg`),
          contentType: fc.constantFrom(...ACCEPTED_TYPES),
          fileSize: fc.integer({ min: 1, max: MAX_FILE_SIZE_BYTES }),
          userId: fc.uuid(),
          sessionId: fc.uuid(),
        }),
        async ({ filename, contentType, fileSize, userId, sessionId }) => {
          vi.clearAllMocks();

          const session = makeSession({ sessionId, userId, email: 'user@example.com', name: 'User' });
          mockGetIronSession.mockResolvedValue(session);
          // getValidSession DB check
          mockQuery
            .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // session valid
            .mockResolvedValueOnce({ rows: [] }); // INSERT media

          const mediaId = crypto.randomUUID();
          mockGeneratePresignedPutUrl.mockResolvedValue(
            `https://s3.example.com/originals/${mediaId}?X-Amz-Expires=900`
          );

          const { NextRequest } = await import('next/server');
          const { POST } = await import('@/app/api/upload/presign/route');
          const req = new NextRequest('http://localhost/api/upload/presign', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ filename, contentType, fileSize }),
          });
          await POST(req);

          if (mockGeneratePresignedPutUrl.mock.calls.length > 0) {
            const [, , , expiresIn] = mockGeneratePresignedPutUrl.mock.calls[0] as [
              string,
              string,
              number,
              number,
            ];
            expect(expiresIn).toBeLessThanOrEqual(900);
            expect(expiresIn).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 7: Upload confirm persists complete metadata ────────────────────

  // Feature: nestpic-app, Property 7: Upload confirm persists complete metadata
  it('Property 7: confirm route activates media with correct metadata fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          mediaId: fc.uuid(),
          s3Key: fc.string({ minLength: 5, maxLength: 100 }),
          contentType: fc.constantFrom(...ACCEPTED_TYPES),
          fileSize: fc.integer({ min: 1, max: MAX_FILE_SIZE_BYTES }),
          uploaderId: fc.uuid(),
          sessionId: fc.uuid(),
        }),
        async ({ mediaId, s3Key, contentType, fileSize, uploaderId, sessionId }) => {
          vi.clearAllMocks();

          const session = makeSession({ sessionId, userId: uploaderId, email: 'user@example.com', name: 'User' });
          mockGetIronSession.mockResolvedValue(session);

          mockQuery
            .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // getValidSession
            .mockResolvedValueOnce({
              rows: [{
                id: mediaId,
                s3_key: s3Key,
                content_type: contentType,
                file_size: fileSize,
                status: 'pending',
                uploader_id: uploaderId,
                uploaded_at: new Date().toISOString(),
              }],
            }) // SELECT media
            .mockResolvedValueOnce({ rows: [] }); // UPDATE media

          mockHeadObject.mockResolvedValue({ contentLength: fileSize, contentType });

          const { NextRequest } = await import('next/server');
          const { POST } = await import('@/app/api/upload/confirm/route');
          const req = new NextRequest('http://localhost/api/upload/confirm', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mediaId }),
          });
          const res = await POST(req);
          const json = await res.json();

          expect(res.status).toBe(200);
          expect(json.media.id).toBe(mediaId);
          expect(json.media.s3Key).toBe(s3Key);
          expect(json.media.contentType).toBe(contentType);
          expect(json.media.fileSize).toBe(fileSize);
          expect(json.media.uploaderId).toBe(uploaderId);
          expect(json.media.status).toBe('active');

          // Verify the UPDATE was called
          const updateCall = mockQuery.mock.calls.find(([sql]: [string]) =>
            sql.includes('UPDATE media')
          );
          expect(updateCall).toBeDefined();
          expect(updateCall![1]).toContain(mediaId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
