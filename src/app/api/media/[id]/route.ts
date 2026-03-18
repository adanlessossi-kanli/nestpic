import { NextRequest } from 'next/server';
import { getValidSession } from '@/lib/auth/session';
import { query } from '@/lib/db';
import { getObjectStore } from '@/lib/objectStore';
import { ok, err } from '@/lib/api/response';

const SIGNED_URL_EXPIRY = 3600;

interface MediaRow {
  id: string;
  uploader_id: string;
  s3_key: string;
  thumbnail_key: string | null;
  content_type: string;
  file_size: number;
  status: string;
  uploaded_at: Date;
  uploader_name: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getValidSession();
  if (!session) {
    return err('UNAUTHORIZED', 'Authentication required', 401);
  }

  const { id } = await params;

  const result = await query<MediaRow>(
    `SELECT m.id, m.uploader_id, m.s3_key, m.thumbnail_key, m.content_type,
            m.file_size, m.status, m.uploaded_at, u.name AS uploader_name
     FROM media m
     JOIN users u ON u.id = m.uploader_id
     WHERE m.id = $1 AND m.status = 'active'`,
    [id]
  );

  if (result.rows.length === 0) {
    return err('NOT_FOUND', 'Media not found', 404);
  }

  const row = result.rows[0];
  const objectStore = await getObjectStore();
  const mediaUrl = await objectStore.generateSignedGetUrl(row.s3_key, SIGNED_URL_EXPIRY);

  let thumbnailUrl: string | null = null;
  if (row.thumbnail_key && row.thumbnail_key.startsWith('thumbnails/')) {
    thumbnailUrl = await objectStore.generateSignedGetUrl(row.thumbnail_key, SIGNED_URL_EXPIRY);
  }

  return ok({
    id: row.id,
    uploaderId: row.uploader_id,
    uploaderName: row.uploader_name,
    contentType: row.content_type,
    fileSize: row.file_size,
    uploadedAt: row.uploaded_at instanceof Date
      ? row.uploaded_at.toISOString()
      : String(row.uploaded_at),
    mediaUrl,
    thumbnailUrl,
  });
}

interface DeleteMediaRow {
  id: string;
  uploader_id: string;
  s3_key: string;
  thumbnail_key: string | null;
  status: string;
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth guaranteed by middleware; retrieve session for ownership check
  const session = (await getValidSession())!;

  const { id } = await params;

  const result = await query<DeleteMediaRow>(
    `SELECT id, uploader_id, s3_key, thumbnail_key, status
     FROM media
     WHERE id = $1 AND status = 'active'`,
    [id]
  );

  if (result.rows.length === 0) {
    return err('NOT_FOUND', 'Media not found', 404);
  }

  const row = result.rows[0];

  if (session.userId !== row.uploader_id) {
    return err('FORBIDDEN', 'You do not own this media', 403);
  }

  const objectStore = await getObjectStore();
  await objectStore.deleteObject(row.s3_key);

  if (row.thumbnail_key) {
    await objectStore.deleteObject(row.thumbnail_key);
  }

  await query('DELETE FROM album_media WHERE media_id = $1', [id]);
  await query('DELETE FROM media WHERE id = $1', [id]);

  return ok({ deleted: true });
}
