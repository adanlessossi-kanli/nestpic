import { NextRequest } from 'next/server';
import { getValidSession } from '@/lib/auth/session';
import { query } from '@/lib/db';
import { getObjectStore } from '@/lib/objectStore';
import { albumQuerySchema } from '@/lib/schemas/albums';
import { ok, err } from '@/lib/api/response';

const PAGE_SIZE = 30;
const SIGNED_URL_EXPIRY = 3600;

interface AlbumMediaRow {
  id: string;
  thumbnail_key: string | null;
  content_type: string;
  s3_key: string;
  uploaded_at: Date;
  uploader_name: string;
  uploader_id: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getValidSession();
  if (!session) {
    return err('UNAUTHORIZED', 'Authentication required', 401);
  }

  const { id } = await params;
  const { searchParams } = request.nextUrl;
  const parsed = albumQuerySchema.safeParse({ cursor: searchParams.get('cursor') ?? undefined });
  if (!parsed.success) {
    return err('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid query params', 400);
  }

  const { cursor } = parsed.data;

  let sql: string;
  let queryParams: unknown[];

  if (cursor) {
    sql = `
      SELECT m.id, m.thumbnail_key, m.content_type, m.s3_key, m.uploaded_at,
             u.name AS uploader_name, m.uploader_id
      FROM album_media am
      JOIN media m ON m.id = am.media_id
      JOIN users u ON u.id = m.uploader_id
      WHERE am.album_id = $1
        AND m.status = 'active'
        AND m.uploaded_at < $2
      ORDER BY m.uploaded_at DESC
      LIMIT $3
    `;
    queryParams = [id, cursor, PAGE_SIZE + 1];
  } else {
    sql = `
      SELECT m.id, m.thumbnail_key, m.content_type, m.s3_key, m.uploaded_at,
             u.name AS uploader_name, m.uploader_id
      FROM album_media am
      JOIN media m ON m.id = am.media_id
      JOIN users u ON u.id = m.uploader_id
      WHERE am.album_id = $1
        AND m.status = 'active'
      ORDER BY m.uploaded_at DESC
      LIMIT $2
    `;
    queryParams = [id, PAGE_SIZE + 1];
  }

  const result = await query<AlbumMediaRow>(sql, queryParams);
  const rows = result.rows;

  const hasNextPage = rows.length > PAGE_SIZE;
  const pageRows = hasNextPage ? rows.slice(0, PAGE_SIZE) : rows;

  const objectStore = await getObjectStore();

  const items = await Promise.all(
    pageRows.map(async (row) => {
      let thumbnailUrl: string | null = null;
      if (row.thumbnail_key) {
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
      };
    })
  );

  const nextCursor = hasNextPage ? items[items.length - 1].uploadedAt : null;

  return ok({ items, nextCursor });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getValidSession();
  if (!session) {
    return err('UNAUTHORIZED', 'Authentication required', 401);
  }

  const { id } = await params;

  // Check album exists
  const albumResult = await query<{ id: string }>(
    'SELECT id FROM albums WHERE id = $1',
    [id]
  );
  if (albumResult.rows.length === 0) {
    return err('NOT_FOUND', 'Album not found', 404);
  }

  // Remove album_media rows first (FK constraint), but preserve media records
  await query('DELETE FROM album_media WHERE album_id = $1', [id]);

  // Delete the album
  await query('DELETE FROM albums WHERE id = $1', [id]);

  return ok({ deleted: true });
}
