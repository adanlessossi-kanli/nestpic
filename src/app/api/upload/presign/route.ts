import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { query } from '@/lib/db';
import { getValidSession } from '@/lib/auth/session';
import { getObjectStore } from '@/lib/objectStore';
import { validateFile } from '@/lib/upload/validateFile';
import { presignSchema } from '@/lib/schemas/upload';
import { ok, err } from '@/lib/api/response';

const PRESIGN_EXPIRY_SECONDS = 900; // 15 minutes

export async function POST(request: NextRequest) {
  // Auth check
  const session = await getValidSession();
  if (!session) {
    return err('UNAUTHORIZED', 'Authentication required', 401);
  }

  // Validate body
  const body = await request.json().catch(() => null);
  const parsed = presignSchema.safeParse(body);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  const { filename, contentType, fileSize } = parsed.data;

  // Validate file type and size
  const validation = validateFile({ mimeType: contentType, size: fileSize });
  if (!validation.ok) {
    return err(validation.error.code, validation.error.message, 400);
  }

  // Generate S3 key and presigned URL
  const mediaId = randomUUID();
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  const s3Key = `originals/${mediaId}${ext}`;

  const objectStore = await getObjectStore();
  const uploadUrl = await objectStore.generatePresignedPutUrl(
    s3Key,
    contentType,
    fileSize,
    PRESIGN_EXPIRY_SECONDS
  );

  // Create pending media record
  await query(
    `INSERT INTO media (id, uploader_id, s3_key, content_type, file_size, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')`,
    [mediaId, session.userId, s3Key, contentType, fileSize]
  );

  return ok({ uploadUrl, mediaId });
}
