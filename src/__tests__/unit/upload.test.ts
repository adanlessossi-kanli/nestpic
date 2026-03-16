import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}));

const mockQuery = vi.fn();
vi.mock('@/lib/db', () => ({ query: mockQuery, default: {} }));

const mockGetIronSession = vi.fn();
vi.mock('iron-session', () => ({ getIronSession: mockGetIronSession }));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));

const mockGeneratePresignedPutUrl = vi.fn();
const mockHeadObject = vi.fn();
const mockDeleteObject = vi.fn();
vi.mock('@/lib/objectStore', () => ({
  getObjectStore: vi.fn().mockResolvedValue({
    generatePresignedPutUrl: mockGeneratePresignedPutUrl,
    generateSignedGetUrl: vi.fn(),
    deleteObject: mockDeleteObject,
    headObject: mockHeadObject,
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...overrides };
  return Object.assign(data, {
    save: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  });
}

function makeRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeAuthSession(userId = crypto.randomUUID(), sessionId = crypto.randomUUID()) {
  const session = makeSession({ sessionId, userId, email: 'user@example.com', name: 'User' });
  mockGetIronSession.mockResolvedValue(session);
  mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] }); // getValidSession
  return { session, userId, sessionId };
}

// ─── validateFile ─────────────────────────────────────────────────────────────

describe('validateFile', () => {
  it('accepts valid JPEG within size limit', async () => {
    const { validateFile } = await import('@/lib/upload/validateFile');
    const result = validateFile({ mimeType: 'image/jpeg', size: 1024 });
    expect(result.ok).toBe(true);
  });

  it('accepts all supported MIME types', async () => {
    const { validateFile, ACCEPTED_MIME_TYPES } = await import('@/lib/upload/validateFile');
    for (const mimeType of ACCEPTED_MIME_TYPES) {
      const result = validateFile({ mimeType, size: 1024 });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects unsupported MIME type', async () => {
    const { validateFile } = await import('@/lib/upload/validateFile');
    const result = validateFile({ mimeType: 'application/pdf', size: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects file exactly at 200 MB + 1 byte', async () => {
    const { validateFile, MAX_FILE_SIZE_BYTES } = await import('@/lib/upload/validateFile');
    const result = validateFile({ mimeType: 'image/jpeg', size: MAX_FILE_SIZE_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FILE_TOO_LARGE');
  });

  it('accepts file exactly at 200 MB', async () => {
    const { validateFile, MAX_FILE_SIZE_BYTES } = await import('@/lib/upload/validateFile');
    const result = validateFile({ mimeType: 'image/jpeg', size: MAX_FILE_SIZE_BYTES });
    expect(result.ok).toBe(true);
  });
});

// ─── POST /api/upload/presign ─────────────────────────────────────────────────

describe('POST /api/upload/presign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGeneratePresignedPutUrl.mockResolvedValue('https://s3.example.com/presigned-url');
  });

  it('returns 401 when not authenticated', async () => {
    const session = makeSession({});
    mockGetIronSession.mockResolvedValue(session);
    mockQuery.mockResolvedValue({ rows: [] }); // no valid session

    const { POST } = await import('@/app/api/upload/presign/route');
    const res = await POST(makeRequest('http://localhost/api/upload/presign', {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      fileSize: 1024,
    }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing required fields', async () => {
    makeAuthSession();
    const { POST } = await import('@/app/api/upload/presign/route');
    const res = await POST(makeRequest('http://localhost/api/upload/presign', {
      filename: 'photo.jpg',
      // missing contentType and fileSize
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for unsupported file type', async () => {
    makeAuthSession();
    const { POST } = await import('@/app/api/upload/presign/route');
    const res = await POST(makeRequest('http://localhost/api/upload/presign', {
      filename: 'doc.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('returns 400 for file exceeding 200 MB', async () => {
    makeAuthSession();
    const { MAX_FILE_SIZE_BYTES } = await import('@/lib/upload/validateFile');
    const { POST } = await import('@/app/api/upload/presign/route');
    const res = await POST(makeRequest('http://localhost/api/upload/presign', {
      filename: 'huge.mp4',
      contentType: 'video/mp4',
      fileSize: MAX_FILE_SIZE_BYTES + 1,
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('FILE_TOO_LARGE');
  });

  it('returns 200 with uploadUrl and mediaId for valid request', async () => {
    const { userId } = makeAuthSession();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT media

    const { POST } = await import('@/app/api/upload/presign/route');
    const res = await POST(makeRequest('http://localhost/api/upload/presign', {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      fileSize: 1024,
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.uploadUrl).toBeDefined();
    expect(json.mediaId).toBeDefined();
    expect(typeof json.mediaId).toBe('string');
  });

  it('calls generatePresignedPutUrl with 900s expiry and correct Content-Type/Length', async () => {
    makeAuthSession();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT media

    const { POST } = await import('@/app/api/upload/presign/route');
    await POST(makeRequest('http://localhost/api/upload/presign', {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      fileSize: 5000,
    }));

    expect(mockGeneratePresignedPutUrl).toHaveBeenCalledWith(
      expect.stringContaining('originals/'),
      'image/jpeg',
      5000,
      900
    );
  });

  it('creates a pending media record in the DB', async () => {
    const { userId } = makeAuthSession();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT media

    const { POST } = await import('@/app/api/upload/presign/route');
    await POST(makeRequest('http://localhost/api/upload/presign', {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      fileSize: 1024,
    }));

    const insertCall = mockQuery.mock.calls.find(([sql]: [string]) =>
      sql.includes('INSERT INTO media')
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params).toContain(userId);
    expect(params).toContain('image/jpeg');
    expect(params).toContain(1024);
  });
});

// ─── POST /api/upload/confirm ─────────────────────────────────────────────────

describe('POST /api/upload/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeadObject.mockResolvedValue({ contentLength: 1024, contentType: 'image/jpeg' });
  });

  it('returns 401 when not authenticated', async () => {
    const session = makeSession({});
    mockGetIronSession.mockResolvedValue(session);
    mockQuery.mockResolvedValue({ rows: [] });

    const { POST } = await import('@/app/api/upload/confirm/route');
    const res = await POST(makeRequest('http://localhost/api/upload/confirm', {
      mediaId: crypto.randomUUID(),
    }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid mediaId format', async () => {
    makeAuthSession();
    const { POST } = await import('@/app/api/upload/confirm/route');
    const res = await POST(makeRequest('http://localhost/api/upload/confirm', {
      mediaId: 'not-a-uuid',
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when media record not found', async () => {
    makeAuthSession();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT media — not found

    const { POST } = await import('@/app/api/upload/confirm/route');
    const res = await POST(makeRequest('http://localhost/api/upload/confirm', {
      mediaId: crypto.randomUUID(),
    }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 when media is already active', async () => {
    const mediaId = crypto.randomUUID();
    makeAuthSession();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: mediaId, s3_key: 'originals/x.jpg', content_type: 'image/jpeg',
               file_size: 1024, status: 'active', uploader_id: crypto.randomUUID(),
               uploaded_at: new Date().toISOString() }],
    });

    const { POST } = await import('@/app/api/upload/confirm/route');
    const res = await POST(makeRequest('http://localhost/api/upload/confirm', { mediaId }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe('ALREADY_ACTIVE');
  });

  it('returns 200 and activates media for valid pending record', async () => {
    const mediaId = crypto.randomUUID();
    const uploaderId = crypto.randomUUID();
    makeAuthSession(uploaderId);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: mediaId, s3_key: 'originals/x.jpg', content_type: 'image/jpeg',
                 file_size: 1024, status: 'pending', uploader_id: uploaderId,
                 uploaded_at: new Date().toISOString() }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const { POST } = await import('@/app/api/upload/confirm/route');
    const res = await POST(makeRequest('http://localhost/api/upload/confirm', { mediaId }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.media.id).toBe(mediaId);
    expect(json.media.status).toBe('active');
  });

  it('calls headObject to verify the upload exists in the store', async () => {
    const mediaId = crypto.randomUUID();
    makeAuthSession();
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: mediaId, s3_key: 'originals/x.jpg', content_type: 'image/jpeg',
                 file_size: 1024, status: 'pending', uploader_id: crypto.randomUUID(),
                 uploaded_at: new Date().toISOString() }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const { POST } = await import('@/app/api/upload/confirm/route');
    await POST(makeRequest('http://localhost/api/upload/confirm', { mediaId }));
    expect(mockHeadObject).toHaveBeenCalledWith('originals/x.jpg');
  });
});


describe('cleanupPendingMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteObject.mockResolvedValue(undefined);
  });

  it('returns 0 when no stale pending records exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { cleanupPendingMedia } = await import('@/lib/upload/cleanupPending');
    const count = await cleanupPendingMedia();
    expect(count).toBe(0);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('deletes S3 objects and DB records for stale pending media', async () => {
    const stale = [
      { id: crypto.randomUUID(), s3_key: 'originals/a.jpg' },
      { id: crypto.randomUUID(), s3_key: 'originals/b.mp4' },
    ];
    mockQuery
      .mockResolvedValueOnce({ rows: stale })
      .mockResolvedValueOnce({ rows: [] });

    const { cleanupPendingMedia } = await import('@/lib/upload/cleanupPending');
    const count = await cleanupPendingMedia();

    expect(count).toBe(2);
    expect(mockDeleteObject).toHaveBeenCalledTimes(2);
    expect(mockDeleteObject).toHaveBeenCalledWith('originals/a.jpg');
    expect(mockDeleteObject).toHaveBeenCalledWith('originals/b.mp4');
    const deleteCall = mockQuery.mock.calls.find(([sql]: [string]) =>
      sql.includes('DELETE FROM media')
    );
    expect(deleteCall).toBeDefined();
  });

  it('continues cleanup even if some S3 deletes fail', async () => {
    const stale = [
      { id: crypto.randomUUID(), s3_key: 'originals/a.jpg' },
      { id: crypto.randomUUID(), s3_key: 'originals/b.mp4' },
    ];
    mockQuery
      .mockResolvedValueOnce({ rows: stale })
      .mockResolvedValueOnce({ rows: [] });
    mockDeleteObject
      .mockRejectedValueOnce(new Error('S3 error'))
      .mockResolvedValueOnce(undefined);

    const { cleanupPendingMedia } = await import('@/lib/upload/cleanupPending');
    const count = await cleanupPendingMedia();
    expect(count).toBe(2);
  });
});

// ─── Upload Zod schemas ───────────────────────────────────────────────────────

describe('Upload Zod schemas', () => {
  it('presignSchema rejects missing contentType', async () => {
    const { presignSchema } = await import('@/lib/schemas/upload');
    const result = presignSchema.safeParse({ filename: 'photo.jpg', fileSize: 1024 });
    expect(result.success).toBe(false);
  });

  it('presignSchema rejects negative fileSize', async () => {
    const { presignSchema } = await import('@/lib/schemas/upload');
    const result = presignSchema.safeParse({ filename: 'photo.jpg', contentType: 'image/jpeg', fileSize: -1 });
    expect(result.success).toBe(false);
  });

  it('presignSchema accepts valid input', async () => {
    const { presignSchema } = await import('@/lib/schemas/upload');
    const result = presignSchema.safeParse({ filename: 'photo.jpg', contentType: 'image/jpeg', fileSize: 1024 });
    expect(result.success).toBe(true);
  });

  it('confirmSchema rejects non-UUID mediaId', async () => {
    const { confirmSchema } = await import('@/lib/schemas/upload');
    const result = confirmSchema.safeParse({ mediaId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('confirmSchema accepts valid UUID', async () => {
    const { confirmSchema } = await import('@/lib/schemas/upload');
    const result = confirmSchema.safeParse({ mediaId: crypto.randomUUID() });
    expect(result.success).toBe(true);
  });
});
