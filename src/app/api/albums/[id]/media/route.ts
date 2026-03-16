import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { addMediaToAlbumSchema } from '@/lib/schemas/albums';
import { ok, err } from '@/lib/api/response';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: albumId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const parsed = addMediaToAlbumSchema.safeParse(body);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request body', 400);
  }

  const { mediaId } = parsed.data;

  // Check album exists
  const albumResult = await query<{ id: string }>(
    'SELECT id FROM albums WHERE id = $1',
    [albumId]
  );
  if (albumResult.rows.length === 0) {
    return err('NOT_FOUND', 'Album not found', 404);
  }

  try {
    await query(
      `INSERT INTO album_media (album_id, media_id, added_at)
       VALUES ($1, $2, now())`,
      [albumId, mediaId]
    );
  } catch (e: unknown) {
    // Duplicate key violation (media already in album)
    if (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code: string }).code === '23505'
    ) {
      return err('CONFLICT', 'Media already in album', 409);
    }
    throw e;
  }

  return ok({ albumId, mediaId });
}
