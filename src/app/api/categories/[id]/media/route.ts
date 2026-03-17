import { NextRequest } from 'next/server';
import { getValidSession } from '@/lib/auth/session';
import { query } from '@/lib/db';
import { getObjectStore } from '@/lib/objectStore';
import { feedQuerySchema } from '@/lib/schemas/feed';
import { ok, err } from '@/lib/api/response';
import type { FeedItem } from '@/lib/types/media';

const PAGE_SIZE = 30;
const SIGNED_URL_EXPIRY = 3600;

interface MediaRow {
  id: string;
  thumbnail_key: string | null;
  content_type: string;
  s3_key: string;
  uploaded_at: Date;
  uploader_name: string;
  uploader_id: string;
  label: string | null;
  category_name: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getValidSession();
  if (!session) {
    return err('UNAUTHORIZED', 'Authentication required', 401);
  }

  const { id: categoryId } = await params;

  // Verify category exists
  const categoryResult = await query<{ id: string }>(
    'SELECT id FROM categories WHERE id = $1',
    [categoryId]
  );
  if (categoryResult.rows.length === 0) {
    return err('NOT_FOUND', 'Category not found', 404);
  }

  const { searchParams } = request.nextUrl;
  const parsed = feedQuerySchema.safeParse({ cursor: searchParams.get('cursor') ?? undefined });
  if (!parsed.success) {
    return err('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid query params', 400);
  }

  const { cursor } = parsed.data;

  let sql: string;
  let queryParams: unknown[];

  if (cursor) {
    sql = `
      SELECT m.id, m.thumbnail_key, m.content_type, m.s3_key, m.uploaded_at,
             u.name AS uploader_name, m.uploader_id,
             m.label, c.name AS category_name
      FROM media m
      JOIN users u ON u.id = m.uploader_id
      LEFT JOIN categories c ON c.id = m.category_id
      WHERE m.status = 'active'
        AND m.category_id = $1
        AND m.uploaded_at < $2
      ORDER BY m.uploaded_at DESC
      LIMIT $3
    `;
    queryParams = [categoryId, cursor, PAGE_SIZE + 1];
  } else {
    sql = `
      SELECT m.id, m.thumbnail_key, m.content_type, m.s3_key, m.uploaded_at,
             u.name AS uploader_name, m.uploader_id,
             m.label, c.name AS category_name
      FROM media m
      JOIN users u ON u.id = m.uploader_id
      LEFT JOIN categories c ON c.id = m.category_id
      WHERE m.status = 'active'
        AND m.category_id = $1
      ORDER BY m.uploaded_at DESC
      LIMIT $2
    `;
    queryParams = [categoryId, PAGE_SIZE + 1];
  }

  const result = await query<MediaRow>(sql, queryParams);
  const rows = result.rows;

  const hasNextPage = rows.length > PAGE_SIZE;
  const pageRows = hasNextPage ? rows.slice(0, PAGE_SIZE) : rows;

  const objectStore = await getObjectStore();

  const items: FeedItem[] = await Promise.all(
    pageRows.map(async (row) => {
      let thumbnailUrl: string | null = null;
      if (row.thumbnail_key && row.thumbnail_key.startsWith('thumbnails/')) {
        thumbnailUrl = await objectStore.generateSignedGetUrl(row.thumbnail_key, SIGNED_URL_EXPIRY);
      }
      return {
        id: row.id,
        thumbnailUrl,
        uploaderName: row.uploader_name,
        uploaderId: row.uploader_id,
        uploadedAt: row.uploaded_at instanceof Date
          ? row.uploaded_at.toISOString()
          : String(row.uploaded_at),
        contentType: row.content_type,
        s3Key: row.s3_key,
        label: row.label ?? null,
        category: row.category_name ?? null,
      };
    })
  );

  const nextCursor = hasNextPage ? items[items.length - 1].uploadedAt : null;

  return ok({ items, nextCursor });
}
