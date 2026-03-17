import { NextRequest } from 'next/server';
import { getValidSession } from '@/lib/auth/session';
import { query } from '@/lib/db';
import { getObjectStore } from '@/lib/objectStore';
import { confirmSchema } from '@/lib/schemas/upload';
import { ok, err } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  // Auth check
  const session = await getValidSession();
  if (!session) {
    return err('UNAUTHORIZED', 'Authentication required', 401);
  }

  // Validate body
  const body = await request.json().catch(() => null);
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  const { mediaId, category } = parsed.data;

  // Look up pending media record (include label)
  const result = await query<{
    id: string;
    s3_key: string;
    content_type: string;
    file_size: number;
    status: string;
    uploader_id: string;
    uploaded_at: string;
    label: string | null;
  }>(
    'SELECT id, s3_key, content_type, file_size, status, uploader_id, uploaded_at, label FROM media WHERE id = $1',
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

  // Resolve category if provided
  let categoryId: string | null = null;
  let categoryName: string | null = null;

  if (category) {
    // Upsert category — insert if not exists, then select the id
    await query(
      `INSERT INTO categories (name, created_by) VALUES ($1, $2) ON CONFLICT (name, created_by) DO NOTHING`,
      [category, session.userId]
    );
    const catResult = await query<{ id: string }>(
      `SELECT id FROM categories WHERE name = $1 AND created_by = $2`,
      [category, session.userId]
    );
    categoryId = catResult.rows[0]?.id ?? null;
    categoryName = category;
  }

  // Activate the media record, linking category if resolved
  await query(
    `UPDATE media SET status = 'active', uploaded_at = now(), category_id = $2 WHERE id = $1`,
    [mediaId, categoryId]
  );

  return ok({
    media: {
      id: media.id,
      s3Key: media.s3_key,
      contentType: media.content_type,
      fileSize: media.file_size,
      uploaderId: session.userId,
      uploaderName: session.name,
      uploadedAt: new Date().toISOString(),
      status: 'active',
      thumbnailUrl: null,
      label: media.label ?? null,
      category: categoryName,
    },
  });
}
