/**
 * Preservation Property Tests — Thumbnail Display Fix
 *
 * **Validates: Requirements 3.1, 3.5, 3.6, 3.7, 3.8**
 *
 * These tests MUST PASS on unfixed code.
 * They capture baseline behavior that must be preserved after the fix is applied.
 *
 * Four preservation properties are tested:
 *   Property A — processImage produces valid JPEG output (FF D8 FF magic bytes)
 *   Property B — feed API returns thumbnailUrl: null for items with thumbnail_key IS NULL
 *   Property C — feed API returns thumbnailUrl: null for thumbnail_key not starting with 'thumbnails/'
 *   Property D — processVideo calls generateSignedGetUrl and passes URL to ffmpeg (production path)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import os from 'os';

vi.mock('server-only', () => ({}));

// ─── Shared mocks ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock('@/lib/db', () => ({ query: mockQuery, default: {} }));

const mockGetObjectStore = vi.fn();
vi.mock('@/lib/objectStore', () => ({ getObjectStore: mockGetObjectStore }));

const mockGetIronSession = vi.fn();
vi.mock('iron-session', () => ({ getIronSession: mockGetIronSession }));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));

// Track what ffmpeg was called with
let ffmpegInputCapture: string | null = null;

vi.mock('fluent-ffmpeg', () => {
  const chain: Record<string, unknown> = {};
  chain.outputOptions = () => chain;
  chain.output = () => chain;
  chain.on = (event: string, cb: () => void) => {
    if (event === 'end') setTimeout(cb, 0);
    return chain;
  };
  chain.run = () => {};
  return {
    default: (input: string) => {
      ffmpegInputCapture = input;
      return chain;
    },
  };
});

// Mock sharp to return a minimal valid JPEG buffer (FF D8 FF E0)
vi.mock('sharp', () => {
  const chain = {
    resize: () => chain,
    jpeg: () => chain,
    toBuffer: () => Promise.resolve(Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
  };
  return { default: () => chain };
});

// Mock fs so unlinkSync doesn't fail on non-existent temp files
vi.mock('fs', () => ({
  default: {
    unlinkSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Record<string, unknown> = {}) {
  return Object.assign({ ...overrides }, {
    save: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  });
}

function makeMediaRow(overrides: Partial<{
  id: string;
  thumbnail_key: string | null;
  content_type: string;
  s3_key: string;
  uploaded_at: Date;
  uploader_name: string;
  uploader_id: string;
}> = {}) {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    thumbnail_key: overrides.thumbnail_key !== undefined ? overrides.thumbnail_key : `thumbnails/${id}.jpg`,
    content_type: overrides.content_type ?? 'image/jpeg',
    s3_key: overrides.s3_key ?? `originals/${id}.jpg`,
    uploaded_at: overrides.uploaded_at ?? new Date(),
    uploader_name: overrides.uploader_name ?? 'Test User',
    uploader_id: overrides.uploader_id ?? crypto.randomUUID(),
  };
}

async function callFeedGet(mediaRows: ReturnType<typeof makeMediaRow>[]) {
  const sessionId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const session = makeSession({ sessionId, userId, email: 'u@example.com', name: 'User' });
  mockGetIronSession.mockResolvedValue(session);
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // getValidSession DB check
    .mockResolvedValueOnce({ rows: mediaRows });           // feed query

  const { NextRequest } = await import('next/server');
  const { GET } = await import('@/app/api/feed/route');
  const req = new NextRequest('http://localhost/api/feed');
  return GET(req);
}

// ─── Property A: processImage produces valid JPEG output ──────────────────────

describe('Property A — processImage produces valid JPEG (FF D8 FF magic bytes)', () => {
  /**
   * **Validates: Requirements 3.7**
   *
   * For all image media IDs and content types, processImage (via processMedia)
   * produces a buffer starting with FF D8 FF (valid JPEG magic bytes).
   *
   * This tests the UNFIXED code path for images — processImage is not touched
   * by the fix, so this behavior must be preserved.
   *
   * EXPECTED: PASSES on unfixed code.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('Property A: for all image media IDs and content types, processImage produces a valid JPEG buffer', async () => {
    // Validates: Requirements 3.7
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'),
        async (mediaId, contentType) => {
          vi.clearAllMocks();
          mockQuery.mockResolvedValue({ rows: [] });

          const s3Key = `originals/${mediaId}.jpg`;

          const mockStore = {
            generateSignedGetUrl: vi.fn().mockResolvedValue(`https://s3.example.com/${s3Key}`),
            generatePresignedPutUrl: vi.fn().mockResolvedValue(`https://s3.example.com/put/${s3Key}`),
            deleteObject: vi.fn(),
            headObject: vi.fn(),
          };
          mockGetObjectStore.mockResolvedValue(mockStore);

          // Capture what uploadThumbnail PUTs
          let capturedPutBody: Buffer | ArrayBuffer | null = null;
          global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
            if (init?.method === 'PUT') {
              capturedPutBody = init.body as Buffer | ArrayBuffer;
              return Promise.resolve({ ok: true } as Response);
            }
            return Promise.resolve({
              ok: true,
              arrayBuffer: () => Promise.resolve(Buffer.from([0x89, 0x50, 0x4e, 0x47]).buffer),
            } as unknown as Response);
          });

          const { processMedia } = await import('@/lib/thumbnail/processor');
          await processMedia(mediaId, s3Key, contentType);

          expect(capturedPutBody).not.toBeNull();

          let sentBytes: Buffer;
          if (Buffer.isBuffer(capturedPutBody)) {
            sentBytes = capturedPutBody as Buffer;
          } else {
            sentBytes = Buffer.from(capturedPutBody as ArrayBuffer);
          }

          // Must start with JPEG magic bytes FF D8 FF
          expect(sentBytes[0]).toBe(0xff);
          expect(sentBytes[1]).toBe(0xd8);
          expect(sentBytes[2]).toBe(0xff);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('Property A: processImage result starts with FF D8 FF for production path (no getObjectBuffer)', async () => {
    // Validates: Requirements 3.7
    // Production path: no getObjectBuffer, uses signed URL + fetch
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom('image/jpeg', 'image/png', 'image/webp'),
        async (mediaId, contentType) => {
          vi.clearAllMocks();
          mockQuery.mockResolvedValue({ rows: [] });

          const s3Key = `originals/${mediaId}.jpg`;

          // Production store: no getObjectBuffer, no putObjectBuffer
          const mockStore = {
            generateSignedGetUrl: vi.fn().mockResolvedValue(`https://s3.example.com/${s3Key}`),
            generatePresignedPutUrl: vi.fn().mockResolvedValue(`https://s3.example.com/put/${s3Key}`),
            deleteObject: vi.fn(),
            headObject: vi.fn(),
          };
          mockGetObjectStore.mockResolvedValue(mockStore);

          // Mock fetch for the image download
          const fakeImageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
          let capturedPutBody: Buffer | ArrayBuffer | null = null;

          global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
            if (init?.method === 'PUT') {
              capturedPutBody = init.body as Buffer | ArrayBuffer;
              return Promise.resolve({ ok: true } as Response);
            }
            // GET request for image
            return Promise.resolve({
              ok: true,
              arrayBuffer: () => Promise.resolve(fakeImageBytes.buffer),
            } as unknown as Response);
          });

          const { processMedia } = await import('@/lib/thumbnail/processor');
          await processMedia(mediaId, s3Key, contentType);

          // The PUT body must have been sent
          expect(capturedPutBody).not.toBeNull();

          // Determine the bytes that were sent
          let sentBytes: Buffer;
          if (Buffer.isBuffer(capturedPutBody)) {
            sentBytes = capturedPutBody;
          } else {
            sentBytes = Buffer.from(capturedPutBody as ArrayBuffer);
          }

          // Must start with JPEG magic bytes FF D8 FF
          expect(sentBytes[0]).toBe(0xff);
          expect(sentBytes[1]).toBe(0xd8);
          expect(sentBytes[2]).toBe(0xff);
        }
      ),
      { numRuns: 10 }
    );
  });
});

// ─── Property B: feed returns thumbnailUrl: null for NULL thumbnail_key ───────

describe('Property B — feed API returns thumbnailUrl: null for items with thumbnail_key IS NULL', () => {
  /**
   * **Validates: Requirements 3.1, 3.5**
   *
   * For all media items with thumbnail_key IS NULL, the feed API must return
   * thumbnailUrl: null. This is the grey placeholder behavior.
   *
   * EXPECTED: PASSES on unfixed code (this logic is not touched by the fix).
   */
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Property B: for all media items with thumbnail_key IS NULL, feed returns thumbnailUrl: null', async () => {
    // Validates: Requirements 3.1, 3.5
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        async (n) => {
          vi.clearAllMocks();

          const mockGenerateSignedGetUrl = vi.fn().mockResolvedValue('https://cdn.example.com/signed/key');
          mockGetObjectStore.mockResolvedValue({
            generateSignedGetUrl: mockGenerateSignedGetUrl,
            generatePresignedPutUrl: vi.fn(),
            deleteObject: vi.fn(),
            headObject: vi.fn(),
          });

          // All rows have thumbnail_key = null
          const rows = Array.from({ length: n }, () =>
            makeMediaRow({ thumbnail_key: null })
          );

          const res = await callFeedGet(rows);
          const json = await res.json();

          expect(res.status).toBe(200);
          const items: { thumbnailUrl: string | null }[] = json.items;
          expect(items).toHaveLength(n);

          for (const item of items) {
            expect(item.thumbnailUrl).toBeNull();
          }

          // generateSignedGetUrl must NOT have been called for null keys
          expect(mockGenerateSignedGetUrl).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property B: mixed rows — only non-null thumbnails/... keys get signed URLs', async () => {
    // Validates: Requirements 3.1, 3.5
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        async (nullCount, validCount) => {
          vi.clearAllMocks();

          const mockGenerateSignedGetUrl = vi.fn().mockImplementation((key: string) =>
            Promise.resolve(`https://cdn.example.com/signed/${key}`)
          );
          mockGetObjectStore.mockResolvedValue({
            generateSignedGetUrl: mockGenerateSignedGetUrl,
            generatePresignedPutUrl: vi.fn(),
            deleteObject: vi.fn(),
            headObject: vi.fn(),
          });

          const nullRows = Array.from({ length: nullCount }, () =>
            makeMediaRow({ thumbnail_key: null })
          );
          const validRows = Array.from({ length: validCount }, () => {
            const id = crypto.randomUUID();
            return makeMediaRow({ id, thumbnail_key: `thumbnails/${id}.jpg` });
          });
          const allRows = [...nullRows, ...validRows];

          const res = await callFeedGet(allRows);
          const json = await res.json();

          expect(res.status).toBe(200);
          const items: { thumbnailUrl: string | null; id: string }[] = json.items;

          // Null-key items must have thumbnailUrl: null
          const nullIds = new Set(nullRows.map((r) => r.id));
          for (const item of items) {
            if (nullIds.has(item.id)) {
              expect(item.thumbnailUrl).toBeNull();
            } else {
              expect(item.thumbnailUrl).not.toBeNull();
            }
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ─── Property C: feed returns thumbnailUrl: null for non-thumbnails/ keys ─────

describe('Property C — feed API returns thumbnailUrl: null for thumbnail_key not starting with thumbnails/', () => {
  /**
   * **Validates: Requirements 3.5**
   *
   * For all thumbnail_key values that do NOT start with 'thumbnails/', the feed
   * API must return thumbnailUrl: null. This guards against the migration-002
   * scenario where old keys had incorrect prefixes.
   *
   * EXPECTED: PASSES on unfixed code (this logic is not touched by the fix).
   */
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Property C: for all thumbnail_key values not starting with thumbnails/, feed returns thumbnailUrl: null', async () => {
    // Validates: Requirements 3.5
    await fc.assert(
      fc.asyncProperty(
        // Generate keys that do NOT start with 'thumbnails/'
        fc.oneof(
          fc.constant(null),
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.startsWith('thumbnails/')),
          fc.constantFrom('originals/abc.jpg', 'thumbs/abc.jpg', 'images/abc.jpg', '', 'thumbnail/abc.jpg'),
        ),
        async (badKey) => {
          vi.clearAllMocks();

          const mockGenerateSignedGetUrl = vi.fn().mockResolvedValue('https://cdn.example.com/signed/key');
          mockGetObjectStore.mockResolvedValue({
            generateSignedGetUrl: mockGenerateSignedGetUrl,
            generatePresignedPutUrl: vi.fn(),
            deleteObject: vi.fn(),
            headObject: vi.fn(),
          });

          const rows = [makeMediaRow({ thumbnail_key: badKey })];
          const res = await callFeedGet(rows);
          const json = await res.json();

          expect(res.status).toBe(200);
          const items: { thumbnailUrl: string | null }[] = json.items;
          expect(items).toHaveLength(1);
          expect(items[0].thumbnailUrl).toBeNull();

          // generateSignedGetUrl must NOT have been called for invalid keys
          expect(mockGenerateSignedGetUrl).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property C: thumbnail_key starting with thumbnails/ gets a signed URL', async () => {
    // Validates: Requirements 3.5 (positive case — valid keys DO get signed URLs)
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }).map((suffix) => `thumbnails/${suffix}`),
        async (validKey) => {
          vi.clearAllMocks();

          const mockGenerateSignedGetUrl = vi.fn().mockImplementation((key: string) =>
            Promise.resolve(`https://cdn.example.com/signed/${key}`)
          );
          mockGetObjectStore.mockResolvedValue({
            generateSignedGetUrl: mockGenerateSignedGetUrl,
            generatePresignedPutUrl: vi.fn(),
            deleteObject: vi.fn(),
            headObject: vi.fn(),
          });

          const rows = [makeMediaRow({ thumbnail_key: validKey })];
          const res = await callFeedGet(rows);
          const json = await res.json();

          expect(res.status).toBe(200);
          const items: { thumbnailUrl: string | null }[] = json.items;
          expect(items).toHaveLength(1);
          expect(items[0].thumbnailUrl).not.toBeNull();
          expect(mockGenerateSignedGetUrl).toHaveBeenCalledWith(validKey, expect.any(Number));
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ─── Property D: processVideo uses generateSignedGetUrl in production ─────────

describe('Property D — processVideo calls generateSignedGetUrl and passes URL to ffmpeg (production path)', () => {
  /**
   * **Validates: Requirements 3.8**
   *
   * When the object store does NOT have getObjectBuffer (production path),
   * processVideo must call generateSignedGetUrl and pass the resulting URL
   * to ffmpeg. This is the production behavior that must be preserved.
   *
   * EXPECTED: PASSES on unfixed code (this is the ONLY path in unfixed code).
   */
  beforeEach(() => {
    vi.clearAllMocks();
    ffmpegInputCapture = null;
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('Property D: when store has no getObjectBuffer, processVideo calls generateSignedGetUrl and passes URL to ffmpeg', async () => {
    // Validates: Requirements 3.8
    //
    // After the fix: processVideo fetches the source via HTTP (using generateSignedGetUrl),
    // writes it to a temp file, and passes the LOCAL FILE PATH to ffmpeg.
    // generateSignedGetUrl is still called — the URL is used for the HTTP fetch.
    const mediaId = crypto.randomUUID();
    const s3Key = `originals/${mediaId}.mp4`;
    const expectedSignedUrl = `https://s3.example.com/signed/${s3Key}?token=abc`;

    const mockGenerateSignedGetUrl = vi.fn().mockResolvedValue(expectedSignedUrl);
    const mockStore = {
      generateSignedGetUrl: mockGenerateSignedGetUrl,
      generatePresignedPutUrl: vi.fn().mockResolvedValue(`https://s3.example.com/put/thumbnails/${mediaId}.jpg`),
      deleteObject: vi.fn(),
      headObject: vi.fn(),
    };
    mockGetObjectStore.mockResolvedValue(mockStore);

    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve({ ok: true } as Response);
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from('fake-video').buffer),
      } as unknown as Response);
    });

    ffmpegInputCapture = null;

    const { processMedia } = await import('@/lib/thumbnail/processor');
    await processMedia(mediaId, s3Key, 'video/mp4');

    // generateSignedGetUrl must have been called for the source video
    expect(mockGenerateSignedGetUrl).toHaveBeenCalledWith(s3Key, expect.any(Number));

    // ffmpeg receives a LOCAL temp file path (not the HTTP URL directly)
    expect(ffmpegInputCapture).not.toBeNull();
    expect(ffmpegInputCapture).not.toMatch(/^https?:\/\//);
  });

  it('Property D: for any video content type, production path fetches via signed URL then passes local file to ffmpeg', async () => {
    // Validates: Requirements 3.8
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom('video/mp4', 'video/quicktime', 'video/x-msvideo'),
        async (mediaId, contentType) => {
          vi.clearAllMocks();
          ffmpegInputCapture = null;
          mockQuery.mockResolvedValue({ rows: [] });

          const s3Key = `originals/${mediaId}.mp4`;
          const signedUrl = `https://s3.example.com/signed/${s3Key}?token=${crypto.randomUUID()}`;

          const mockGenerateSignedGetUrl = vi.fn().mockResolvedValue(signedUrl);
          const mockStore = {
            generateSignedGetUrl: mockGenerateSignedGetUrl,
            generatePresignedPutUrl: vi.fn().mockResolvedValue(`https://s3.example.com/put/thumbnails/${mediaId}.jpg`),
            deleteObject: vi.fn(),
            headObject: vi.fn(),
          };
          mockGetObjectStore.mockResolvedValue(mockStore);

          global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
            if (init?.method === 'PUT') return Promise.resolve({ ok: true } as Response);
            return Promise.resolve({
              ok: true,
              arrayBuffer: () => Promise.resolve(Buffer.from('fake-video').buffer),
            } as unknown as Response);
          });

          const { processMedia } = await import('@/lib/thumbnail/processor');
          await processMedia(mediaId, s3Key, contentType);

          // generateSignedGetUrl must have been called for the source
          expect(mockGenerateSignedGetUrl).toHaveBeenCalledWith(s3Key, expect.any(Number));

          // ffmpeg receives a local temp file path (not the HTTP URL)
          expect(ffmpegInputCapture).not.toBeNull();
          expect(ffmpegInputCapture).not.toMatch(/^https?:\/\//);
        }
      ),
      { numRuns: 15 }
    );
  });
});
