import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getObjectStore } from '@/lib/objectStore';
import { confirmSchema } from '@/lib/schemas/upload';
import { ok, err } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  // Validate body
  const body = await request.json().catch(() => null);
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  const { mediaId } = parsed.data;

  // Look up pending media record
  const result = await query<{
    id: string;
    s3_key: string;
    content_type: string;
    file_size: number;
    status: string;
    uploader_id: string;
    uploaded_at: string;
  }>(
    'SELECT id, s3_key, content_type, file_size, status, uploader_id, uploaded_at FROM media WHERE id = $1',
    [mediaId]
  );

  const media = result.rows[0];

  if (!media) {
    return err('NOT_FOUND', 'Media record not found', 404);
  }

  if (media.status === 'active') {
    return err('ALREADY_ACTIVE', 'Media has already been confirmed', 409);
  }

  // Verify the object actually exists in the store
  const objectStore = await getObjectStore();
  await objectStore.headObject(media.s3_key);

  // Activate the media record
  await query(
    `UPDATE media SET status = 'active', uploaded_at = now() WHERE id = $1`,
    [mediaId]
  );

  return ok({
    media: {
      id: media.id,
      s3Key: media.s3_key,
      contentType: media.content_type,
      fileSize: media.file_size,
      uploaderId: media.uploader_id,
      status: 'active',
    },
  });
}
