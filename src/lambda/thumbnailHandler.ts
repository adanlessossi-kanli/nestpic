interface S3EventRecord {
  s3: {
    object: { key: string };
  };
}

interface S3Event {
  Records: S3EventRecord[];
}

interface MediaRow {
  id: string;
  s3_key: string;
  content_type: string;
}

export async function handler(event: S3Event): Promise<void> {
  // Lazy imports to avoid Next.js server-only guard at module load time
  const { query } = await import('@/lib/db');
  const { processMedia } = await import('@/lib/thumbnail/processor');

  for (const record of event.Records) {
    const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    const result = await query<MediaRow>(
      'SELECT id, s3_key, content_type FROM media WHERE s3_key = $1 LIMIT 1',
      [s3Key]
    );

    if (result.rows.length === 0) {
      throw new Error(`No media record found for s3_key: ${s3Key}`);
    }

    const { id: mediaId, content_type: contentType } = result.rows[0];

    await processMedia(mediaId, s3Key, contentType);
  }
}
