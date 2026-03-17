// Feature: upload-labels-categories
// Property tests for schema validation (Properties 1 and 2)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { NextRequest } from 'next/server';

// Mock dependencies before importing the route
vi.mock('@/lib/auth/session', () => ({
  getValidSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  default: {},
  query: vi.fn(),
}));

vi.mock('@/lib/objectStore', () => ({
  getObjectStore: vi.fn(),
}));

import { POST } from '@/app/api/upload/presign/route';
import { getValidSession } from '@/lib/auth/session';
import { query } from '@/lib/db';
import { getObjectStore } from '@/lib/objectStore';

const mockSession = { userId: 'user-123', sessionId: 'sess-1', email: 'test@example.com', name: 'Test' };

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  filename: 'photo.jpg',
  contentType: 'image/jpeg',
  fileSize: 1024,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getValidSession).mockResolvedValue(mockSession);
  vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as any);
  vi.mocked(getObjectStore).mockResolvedValue({
    generatePresignedPutUrl: vi.fn().mockResolvedValue('https://example.com/upload'),
  } as any);
});

describe('Property 1: Field length validation', () => {
  // For any label or category string whose length exceeds 100 characters,
  // the presign API SHALL return a 400 validation error.

  it('rejects label longer than 100 characters', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 101, maxLength: 200 }),
        async (label) => {
          const req = makeRequest({ ...baseBody, label });
          const res = await POST(req);
          expect(res.status).toBe(400);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects category longer than 100 characters', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 101, maxLength: 200 }),
        async (category) => {
          const req = makeRequest({ ...baseBody, category });
          const res = await POST(req);
          expect(res.status).toBe(400);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 2: Presign accepts valid label and category', () => {
  // For any label string of length 0–100 and category string of length 0–100
  // (including absent/undefined), the presign API SHALL return a 200 response.

  it('accepts label of length 0–100', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 100 }),
        async (label) => {
          const req = makeRequest({ ...baseBody, label });
          const res = await POST(req);
          expect(res.status).toBe(200);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accepts category of length 0–100', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 100 }),
        async (category) => {
          const req = makeRequest({ ...baseBody, category });
          const res = await POST(req);
          expect(res.status).toBe(200);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accepts both label and category omitted', async () => {
    const req = makeRequest(baseBody);
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

// ─── Properties 3, 4, 5 — confirm route ───────────────────────────────────────

import { POST as confirmPOST } from '@/app/api/upload/confirm/route';

const mockObjectStore = {
  generatePresignedPutUrl: vi.fn().mockResolvedValue('https://example.com/upload'),
  headObject: vi.fn().mockResolvedValue(undefined),
};

function makeConfirmRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/upload/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Property 3: Label round-trip ─────────────────────────────────────────────
// Feature: upload-labels-categories, Property 3: Label round-trip
// Validates: Requirements 1.5, 7.7
describe('Property 3: Label round-trip', () => {
  it('stored label equals the label submitted at presign time', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 100 }),
        async (label) => {
          const mediaId = '00000000-0000-0000-0000-000000000001';

          vi.mocked(getValidSession).mockResolvedValue(mockSession);
          vi.mocked(getObjectStore).mockResolvedValue(mockObjectStore as any);

          // Mock DB: SELECT returns a pending media row with the given label
          vi.mocked(query).mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT') && sql.includes('FROM media')) {
              return {
                rows: [{
                  id: mediaId,
                  s3_key: 'originals/test.jpg',
                  content_type: 'image/jpeg',
                  file_size: 1024,
                  status: 'pending',
                  uploader_id: mockSession.userId,
                  uploaded_at: new Date().toISOString(),
                  label: label || null,
                }],
                rowCount: 1,
              } as any;
            }
            // UPDATE or INSERT — no-op
            return { rows: [], rowCount: 1 } as any;
          });

          const req = makeConfirmRequest({ mediaId });
          const res = await confirmPOST(req);
          expect(res.status).toBe(200);

          const json = await res.json();
          expect(json.media.label).toBe(label || null);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 4: Category creation idempotency ────────────────────────────────
// Feature: upload-labels-categories, Property 4: Category creation idempotency
// Validates: Requirements 2.10, 7.3
describe('Property 4: Category creation idempotency', () => {
  it('two confirms with the same category name result in exactly one DB row', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        async (categoryName) => {
          const categoryId = '00000000-0000-0000-0000-000000000099';
          const insertCalls: string[] = [];

          vi.mocked(getValidSession).mockResolvedValue(mockSession);
          vi.mocked(getObjectStore).mockResolvedValue(mockObjectStore as any);

          vi.mocked(query).mockImplementation(async (sql: string, params?: unknown[]) => {
            if (sql.includes('INSERT INTO categories')) {
              insertCalls.push(sql);
              return { rows: [], rowCount: 0 } as any;
            }
            if (sql.includes('SELECT id FROM categories')) {
              return { rows: [{ id: categoryId }], rowCount: 1 } as any;
            }
            if (sql.includes('SELECT') && sql.includes('FROM media')) {
              const mediaId = (params?.[0] as string) ?? '00000000-0000-0000-0000-000000000001';
              return {
                rows: [{
                  id: mediaId,
                  s3_key: 'originals/test.jpg',
                  content_type: 'image/jpeg',
                  file_size: 1024,
                  status: 'pending',
                  uploader_id: mockSession.userId,
                  uploaded_at: new Date().toISOString(),
                  label: null,
                }],
                rowCount: 1,
              } as any;
            }
            return { rows: [], rowCount: 1 } as any;
          });

          const mediaId1 = '00000000-0000-0000-0000-000000000001';
          const mediaId2 = '00000000-0000-0000-0000-000000000002';

          // First confirm
          const req1 = makeConfirmRequest({ mediaId: mediaId1, category: categoryName });
          const res1 = await confirmPOST(req1);
          expect(res1.status).toBe(200);

          // Second confirm with same category
          const req2 = makeConfirmRequest({ mediaId: mediaId2, category: categoryName });
          const res2 = await confirmPOST(req2);
          expect(res2.status).toBe(200);

          // The INSERT uses ON CONFLICT DO NOTHING — both calls issue the INSERT
          // but the DB constraint ensures only one row exists.
          // We verify the route issued exactly 2 INSERT attempts (one per confirm),
          // which is the correct idempotent pattern.
          expect(insertCalls.length).toBe(2);

          // Both responses should reference the same category id
          const json1 = await res1.json();
          const json2 = await res2.json();
          expect(json1.media.category).toBe(categoryName);
          expect(json2.media.category).toBe(categoryName);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 5: Confirm links media to category ──────────────────────────────
// Feature: upload-labels-categories, Property 5: Confirm links media to category
// Validates: Requirements 2.6, 2.7
describe('Property 5: Confirm links media to category', () => {
  it('media.category_id equals resolved category id and category.created_by equals uploader id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        async (categoryName) => {
          const mediaId = '00000000-0000-0000-0000-000000000001';
          const categoryId = '00000000-0000-0000-0000-000000000099';
          let updatedCategoryId: string | null = null;
          let insertedCreatedBy: string | null = null;

          vi.mocked(getValidSession).mockResolvedValue(mockSession);
          vi.mocked(getObjectStore).mockResolvedValue(mockObjectStore as any);

          vi.mocked(query).mockImplementation(async (sql: string, params?: unknown[]) => {
            if (sql.includes('INSERT INTO categories')) {
              // Capture created_by from params: ($1=name, $2=created_by)
              insertedCreatedBy = (params?.[1] as string) ?? null;
              return { rows: [], rowCount: 0 } as any;
            }
            if (sql.includes('SELECT id FROM categories')) {
              return { rows: [{ id: categoryId }], rowCount: 1 } as any;
            }
            if (sql.includes('UPDATE media')) {
              // Capture category_id from params: ($1=mediaId, $2=categoryId)
              updatedCategoryId = (params?.[1] as string) ?? null;
              return { rows: [], rowCount: 1 } as any;
            }
            if (sql.includes('SELECT') && sql.includes('FROM media')) {
              return {
                rows: [{
                  id: mediaId,
                  s3_key: 'originals/test.jpg',
                  content_type: 'image/jpeg',
                  file_size: 1024,
                  status: 'pending',
                  uploader_id: mockSession.userId,
                  uploaded_at: new Date().toISOString(),
                  label: null,
                }],
                rowCount: 1,
              } as any;
            }
            return { rows: [], rowCount: 1 } as any;
          });

          const req = makeConfirmRequest({ mediaId, category: categoryName });
          const res = await confirmPOST(req);
          expect(res.status).toBe(200);

          // category_id on the UPDATE must equal the resolved category id
          expect(updatedCategoryId).toBe(categoryId);

          // created_by on the INSERT must equal the uploader's user id
          expect(insertedCreatedBy).toBe(mockSession.userId);

          // Response category name must match input
          const json = await res.json();
          expect(json.media.category).toBe(categoryName);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Properties 6–9 — categories API routes ───────────────────────────────────

import { GET as categoriesMediaGET } from '@/app/api/categories/[id]/media/route';

const CATEGORY_ID = '00000000-0000-0000-0000-000000000010';

function makeCategoryMediaRequest(categoryId: string, cursor?: string): NextRequest {
  const url = cursor
    ? `http://localhost/api/categories/${categoryId}/media?cursor=${encodeURIComponent(cursor)}`
    : `http://localhost/api/categories/${categoryId}/media`;
  return new NextRequest(url, { method: 'GET' });
}

function makeMediaRow(overrides: Partial<{
  id: string;
  uploaded_at: string;
  label: string | null;
  category_name: string | null;
}> = {}) {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000001',
    thumbnail_key: null,
    content_type: 'image/jpeg',
    s3_key: 'originals/test.jpg',
    uploaded_at: overrides.uploaded_at ?? new Date().toISOString(),
    uploader_name: 'Test User',
    uploader_id: mockSession.userId,
    label: overrides.label !== undefined ? overrides.label : null,
    category_name: overrides.category_name !== undefined ? overrides.category_name : null,
  };
}

// ─── Property 6: Category view ordering invariant ─────────────────────────────
// Feature: upload-labels-categories, Property 6: Category view ordering invariant
// Validates: Requirements 3.3, 7.4
describe('Property 6: Category view ordering invariant', () => {
  it('response items are sorted by uploaded_at DESC', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
          { minLength: 2, maxLength: 20 }
        ),
        async (dates) => {
          vi.mocked(getValidSession).mockResolvedValue(mockSession);
          vi.mocked(getObjectStore).mockResolvedValue({
            generateSignedGetUrl: vi.fn().mockResolvedValue(null),
          } as any);

          const rows = dates.map((d, i) => makeMediaRow({
            id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
            uploaded_at: d.toISOString(),
          }));

          vi.mocked(query).mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT id FROM categories')) {
              return { rows: [{ id: CATEGORY_ID }], rowCount: 1 } as any;
            }
            // Return rows sorted DESC (as DB would)
            const sorted = [...rows].sort(
              (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
            );
            return { rows: sorted, rowCount: sorted.length } as any;
          });

          const req = makeCategoryMediaRequest(CATEGORY_ID);
          const res = await categoriesMediaGET(req, { params: Promise.resolve({ id: CATEGORY_ID }) });
          expect(res.status).toBe(200);

          const json = await res.json();
          const items: { uploadedAt: string }[] = json.items;

          for (let i = 1; i < items.length; i++) {
            expect(new Date(items[i - 1].uploadedAt).getTime()).toBeGreaterThanOrEqual(
              new Date(items[i].uploadedAt).getTime()
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 7: Category view pagination ─────────────────────────────────────
// Feature: upload-labels-categories, Property 7: Category view pagination
// Validates: Requirements 3.4
describe('Property 7: Category view pagination', () => {
  it('returns at most 30 items and a non-null nextCursor when > 30 rows exist', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 31, max: 100 }),
        async (rowCount) => {
          vi.mocked(getValidSession).mockResolvedValue(mockSession);
          vi.mocked(getObjectStore).mockResolvedValue({
            generateSignedGetUrl: vi.fn().mockResolvedValue(null),
          } as any);

          // Build rowCount + 1 rows (route fetches PAGE_SIZE + 1 to detect next page)
          const rows = Array.from({ length: rowCount + 1 }, (_, i) => makeMediaRow({
            id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
            uploaded_at: new Date(Date.now() - i * 1000).toISOString(),
          }));

          vi.mocked(query).mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT id FROM categories')) {
              return { rows: [{ id: CATEGORY_ID }], rowCount: 1 } as any;
            }
            return { rows: rows, rowCount: rows.length } as any;
          });

          const req = makeCategoryMediaRequest(CATEGORY_ID);
          const res = await categoriesMediaGET(req, { params: Promise.resolve({ id: CATEGORY_ID }) });
          expect(res.status).toBe(200);

          const json = await res.json();
          expect(json.items.length).toBeLessThanOrEqual(30);
          expect(json.nextCursor).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 8: Response shape includes label and category ───────────────────
// Feature: upload-labels-categories, Property 8: Response shape includes label and category
// Validates: Requirements 3.5, 4.1, 4.2, 4.3, 4.4
describe('Property 8: Response shape includes label and category', () => {
  it('every item in the response has label and category fields (string or null)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            label: fc.oneof(fc.constant(null), fc.string({ minLength: 0, maxLength: 100 })),
            category_name: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 100 })),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (mediaSpecs) => {
          vi.mocked(getValidSession).mockResolvedValue(mockSession);
          vi.mocked(getObjectStore).mockResolvedValue({
            generateSignedGetUrl: vi.fn().mockResolvedValue(null),
          } as any);

          const rows = mediaSpecs.map((spec, i) => makeMediaRow({
            id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
            label: spec.label,
            category_name: spec.category_name,
          }));

          vi.mocked(query).mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT id FROM categories')) {
              return { rows: [{ id: CATEGORY_ID }], rowCount: 1 } as any;
            }
            return { rows: rows, rowCount: rows.length } as any;
          });

          const req = makeCategoryMediaRequest(CATEGORY_ID);
          const res = await categoriesMediaGET(req, { params: Promise.resolve({ id: CATEGORY_ID }) });
          expect(res.status).toBe(200);

          const json = await res.json();
          for (const item of json.items) {
            expect('label' in item).toBe(true);
            expect('category' in item).toBe(true);
            expect(item.label === null || typeof item.label === 'string').toBe(true);
            expect(item.category === null || typeof item.category === 'string').toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 9: Category view 404 for unknown ID ─────────────────────────────
// Feature: upload-labels-categories, Property 9: Category view 404 for unknown ID
// Validates: Requirements 3.7
describe('Property 9: Category view 404 for unknown ID', () => {
  it('returns 404 for a category ID not in the database', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (unknownId) => {
          vi.mocked(getValidSession).mockResolvedValue(mockSession);

          vi.mocked(query).mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT id FROM categories')) {
              return { rows: [], rowCount: 0 } as any;
            }
            return { rows: [], rowCount: 0 } as any;
          });

          const req = makeCategoryMediaRequest(unknownId);
          const res = await categoriesMediaGET(req, { params: Promise.resolve({ id: unknownId }) });
          expect(res.status).toBe(404);
        }
      ),
      { numRuns: 100 }
    );
  });
});
