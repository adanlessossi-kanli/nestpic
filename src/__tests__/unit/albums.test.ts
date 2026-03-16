import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}));

const mockQuery = vi.fn();
vi.mock('@/lib/db', () => ({ query: mockQuery, default: {} }));

const mockGetIronSession = vi.fn();
vi.mock('iron-session', () => ({ getIronSession: mockGetIronSession }));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));

const mockGenerateSignedGetUrl = vi.fn();
vi.mock('@/lib/objectStore', () => ({
  getObjectStore: vi.fn().mockResolvedValue({
    generateSignedGetUrl: mockGenerateSignedGetUrl,
    generatePresignedPutUrl: vi.fn(),
    deleteObject: vi.fn(),
    headObject: vi.fn(),
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

function makeAuthSession(userId = crypto.randomUUID(), sessionId = crypto.randomUUID()) {
  const session = makeSession({ sessionId, userId, email: 'user@example.com', name: 'User' });
  mockGetIronSession.mockResolvedValue(session);
  mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] }); // getValidSession
  return { session, userId, sessionId };
}

function makeRequest(url: string, method: string, body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return new NextRequest(url, init);
}

// ─── POST /api/albums ─────────────────────────────────────────────────────────

describe('POST /api/albums', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    mockGetIronSession.mockResolvedValue(makeSession({}));
    mockQuery.mockResolvedValue({ rows: [] });

    const { POST } = await import('@/app/api/albums/route');
    const res = await POST(makeRequest('http://localhost/api/albums', 'POST', { name: 'My Album' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for empty name (Zod validation)', async () => {
    makeAuthSession();
    const { POST } = await import('@/app/api/albums/route');
    const res = await POST(makeRequest('http://localhost/api/albums', 'POST', { name: '' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for name longer than 100 chars', async () => {
    makeAuthSession();
    const { POST } = await import('@/app/api/albums/route');
    const res = await POST(makeRequest('http://localhost/api/albums', 'POST', { name: 'a'.repeat(101) }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 and album record for valid name', async () => {
    const { userId } = makeAuthSession();
    const albumId = crypto.randomUUID();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: albumId, name: 'My Album', created_by: userId, created_at: new Date() }],
    });

    const { POST } = await import('@/app/api/albums/route');
    const res = await POST(makeRequest('http://localhost/api/albums', 'POST', { name: 'My Album' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(albumId);
    expect(json.name).toBe('My Album');
  });

  it('persists name and created_by (userId) in DB INSERT', async () => {
    const { userId } = makeAuthSession();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: crypto.randomUUID(), name: 'Vacation', created_by: userId, created_at: new Date() }],
    });

    const { POST } = await import('@/app/api/albums/route');
    await POST(makeRequest('http://localhost/api/albums', 'POST', { name: 'Vacation' }));

    const insertCall = mockQuery.mock.calls.find(([sql]: [string]) =>
      sql.includes('INSERT INTO albums')
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params).toContain('Vacation');
    expect(params).toContain(userId);
  });
});

// ─── GET /api/albums ──────────────────────────────────────────────────────────

describe('GET /api/albums', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    mockGetIronSession.mockResolvedValue(makeSession({}));
    mockQuery.mockResolvedValue({ rows: [] });

    const { GET } = await import('@/app/api/albums/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 200 with array of albums', async () => {
    makeAuthSession();
    const albums = [
      { id: crypto.randomUUID(), name: 'Album 1', created_by: crypto.randomUUID(), created_at: new Date() },
      { id: crypto.randomUUID(), name: 'Album 2', created_by: crypto.randomUUID(), created_at: new Date() },
    ];
    mockQuery.mockResolvedValueOnce({ rows: albums });

    const { GET } = await import('@/app/api/albums/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json).toHaveLength(2);
  });

  it('returns empty array when no albums exist', async () => {
    makeAuthSession();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { GET } = await import('@/app/api/albums/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });
});

// ─── GET /api/albums/:id ──────────────────────────────────────────────────────

describe('GET /api/albums/:id', () => {
  const albumId = crypto.randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateSignedGetUrl.mockImplementation((key: string) =>
      Promise.resolve(`https://cdn.example.com/signed/${key}`)
    );
  });

  it('returns 401 when not authenticated', async () => {
    mockGetIronSession.mockResolvedValue(makeSession({}));
    mockQuery.mockResolvedValue({ rows: [] });

    const { GET } = await import('@/app/api/albums/[id]/route');
    const res = await GET(
      makeRequest(`http://localhost/api/albums/${albumId}`, 'GET'),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(401);
  });

  it('returns 200 with items and nextCursor=null when ≤30 items', async () => {
    makeAuthSession();
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: crypto.randomUUID(),
      thumbnail_key: `thumbs/img${i}.jpg`,
      content_type: 'image/jpeg',
      s3_key: `originals/img${i}.jpg`,
      uploaded_at: new Date(Date.now() - i * 1000),
      uploader_name: 'User',
    }));
    mockQuery.mockResolvedValueOnce({ rows });

    const { GET } = await import('@/app/api/albums/[id]/route');
    const res = await GET(
      makeRequest(`http://localhost/api/albums/${albumId}`, 'GET'),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(5);
    expect(json.nextCursor).toBeNull();
  });

  it('returns nextCursor when >30 items', async () => {
    makeAuthSession();
    const rows = Array.from({ length: 31 }, (_, i) => ({
      id: crypto.randomUUID(),
      thumbnail_key: `thumbs/img${i}.jpg`,
      content_type: 'image/jpeg',
      s3_key: `originals/img${i}.jpg`,
      uploaded_at: new Date(Date.now() - i * 1000),
      uploader_name: 'User',
    }));
    mockQuery.mockResolvedValueOnce({ rows });

    const { GET } = await import('@/app/api/albums/[id]/route');
    const res = await GET(
      makeRequest(`http://localhost/api/albums/${albumId}`, 'GET'),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(30);
    expect(json.nextCursor).not.toBeNull();
  });

  it('generates signed URLs for thumbnail_key', async () => {
    makeAuthSession();
    const thumbKey = 'thumbs/photo.jpg';
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: crypto.randomUUID(),
        thumbnail_key: thumbKey,
        content_type: 'image/jpeg',
        s3_key: 'originals/photo.jpg',
        uploaded_at: new Date(),
        uploader_name: 'User',
      }],
    });

    const { GET } = await import('@/app/api/albums/[id]/route');
    const res = await GET(
      makeRequest(`http://localhost/api/albums/${albumId}`, 'GET'),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items[0].thumbnailUrl).toBe(`https://cdn.example.com/signed/${thumbKey}`);
    expect(mockGenerateSignedGetUrl).toHaveBeenCalledWith(thumbKey, expect.any(Number));
  });

  it('returns 400 for invalid cursor format', async () => {
    makeAuthSession();

    const { GET } = await import('@/app/api/albums/[id]/route');
    const res = await GET(
      makeRequest(`http://localhost/api/albums/${albumId}?cursor=not-a-date`, 'GET'),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── DELETE /api/albums/:id ───────────────────────────────────────────────────

describe('DELETE /api/albums/:id', () => {
  const albumId = crypto.randomUUID();

  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    mockGetIronSession.mockResolvedValue(makeSession({}));
    mockQuery.mockResolvedValue({ rows: [] });

    const { DELETE } = await import('@/app/api/albums/[id]/route');
    const res = await DELETE(
      makeRequest(`http://localhost/api/albums/${albumId}`, 'DELETE'),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when album not found', async () => {
    makeAuthSession();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT album — not found

    const { DELETE } = await import('@/app/api/albums/[id]/route');
    const res = await DELETE(
      makeRequest(`http://localhost/api/albums/${albumId}`, 'DELETE'),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 200 with { deleted: true } for existing album', async () => {
    makeAuthSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: albumId }] }) // SELECT album
      .mockResolvedValueOnce({ rows: [] })                 // DELETE album_media
      .mockResolvedValueOnce({ rows: [] });                // DELETE albums

    const { DELETE } = await import('@/app/api/albums/[id]/route');
    const res = await DELETE(
      makeRequest(`http://localhost/api/albums/${albumId}`, 'DELETE'),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);
  });

  it('deletes album_media rows before deleting album', async () => {
    makeAuthSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: albumId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { DELETE } = await import('@/app/api/albums/[id]/route');
    await DELETE(
      makeRequest(`http://localhost/api/albums/${albumId}`, 'DELETE'),
      { params: Promise.resolve({ id: albumId }) }
    );

    const albumMediaDelete = mockQuery.mock.calls.find(([sql]: [string]) =>
      sql.includes('DELETE FROM album_media')
    );
    const albumDelete = mockQuery.mock.calls.find(([sql]: [string]) =>
      sql.includes('DELETE FROM albums')
    );
    expect(albumMediaDelete).toBeDefined();
    expect(albumDelete).toBeDefined();

    const albumMediaIdx = mockQuery.mock.calls.indexOf(albumMediaDelete!);
    const albumIdx = mockQuery.mock.calls.indexOf(albumDelete!);
    expect(albumMediaIdx).toBeLessThan(albumIdx);
  });

  it('does NOT delete media records', async () => {
    makeAuthSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: albumId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { DELETE } = await import('@/app/api/albums/[id]/route');
    await DELETE(
      makeRequest(`http://localhost/api/albums/${albumId}`, 'DELETE'),
      { params: Promise.resolve({ id: albumId }) }
    );

    const mediaDelete = mockQuery.mock.calls.find(([sql]: [string]) =>
      sql.includes('DELETE FROM media')
    );
    expect(mediaDelete).toBeUndefined();
  });
});

// ─── POST /api/albums/:id/media ───────────────────────────────────────────────

describe('POST /api/albums/:id/media', () => {
  const albumId = crypto.randomUUID();

  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    mockGetIronSession.mockResolvedValue(makeSession({}));
    mockQuery.mockResolvedValue({ rows: [] });

    const { POST } = await import('@/app/api/albums/[id]/media/route');
    const res = await POST(
      makeRequest(`http://localhost/api/albums/${albumId}/media`, 'POST', { mediaId: crypto.randomUUID() }),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid mediaId (non-UUID)', async () => {
    makeAuthSession();
    const { POST } = await import('@/app/api/albums/[id]/media/route');
    const res = await POST(
      makeRequest(`http://localhost/api/albums/${albumId}/media`, 'POST', { mediaId: 'not-a-uuid' }),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when album not found', async () => {
    makeAuthSession();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT album — not found

    const { POST } = await import('@/app/api/albums/[id]/media/route');
    const res = await POST(
      makeRequest(`http://localhost/api/albums/${albumId}/media`, 'POST', { mediaId: crypto.randomUUID() }),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 when media already in album', async () => {
    makeAuthSession();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: albumId }] }); // SELECT album
    const pgError = Object.assign(new Error('duplicate key'), { code: '23505' });
    mockQuery.mockRejectedValueOnce(pgError);

    const { POST } = await import('@/app/api/albums/[id]/media/route');
    const res = await POST(
      makeRequest(`http://localhost/api/albums/${albumId}/media`, 'POST', { mediaId: crypto.randomUUID() }),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe('CONFLICT');
  });

  it('returns 200 with { albumId, mediaId } for valid request', async () => {
    const mediaId = crypto.randomUUID();
    makeAuthSession();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: albumId }] }) // SELECT album
      .mockResolvedValueOnce({ rows: [] });                // INSERT album_media

    const { POST } = await import('@/app/api/albums/[id]/media/route');
    const res = await POST(
      makeRequest(`http://localhost/api/albums/${albumId}/media`, 'POST', { mediaId }),
      { params: Promise.resolve({ id: albumId }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.albumId).toBe(albumId);
    expect(json.mediaId).toBe(mediaId);
  });
});

// ─── Album Zod schemas ────────────────────────────────────────────────────────

describe('Album Zod schemas', () => {
  it('createAlbumSchema rejects empty name', async () => {
    const { createAlbumSchema } = await import('@/lib/schemas/albums');
    expect(createAlbumSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('createAlbumSchema rejects name > 100 chars', async () => {
    const { createAlbumSchema } = await import('@/lib/schemas/albums');
    expect(createAlbumSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
  });

  it('createAlbumSchema accepts valid name', async () => {
    const { createAlbumSchema } = await import('@/lib/schemas/albums');
    expect(createAlbumSchema.safeParse({ name: 'My Album' }).success).toBe(true);
  });

  it('albumQuerySchema accepts valid ISO datetime cursor', async () => {
    const { albumQuerySchema } = await import('@/lib/schemas/albums');
    expect(albumQuerySchema.safeParse({ cursor: '2024-01-15T10:30:00.000Z' }).success).toBe(true);
  });

  it('albumQuerySchema rejects non-datetime cursor', async () => {
    const { albumQuerySchema } = await import('@/lib/schemas/albums');
    expect(albumQuerySchema.safeParse({ cursor: 'not-a-date' }).success).toBe(false);
  });

  it('addMediaToAlbumSchema rejects non-UUID mediaId', async () => {
    const { addMediaToAlbumSchema } = await import('@/lib/schemas/albums');
    expect(addMediaToAlbumSchema.safeParse({ mediaId: 'not-a-uuid' }).success).toBe(false);
  });

  it('addMediaToAlbumSchema accepts valid UUID', async () => {
    const { addMediaToAlbumSchema } = await import('@/lib/schemas/albums');
    expect(addMediaToAlbumSchema.safeParse({ mediaId: crypto.randomUUID() }).success).toBe(true);
  });
});
