import 'server-only';
import { query } from '@/lib/db';
import { getObjectStore } from '@/lib/objectStore';

/**
 * Deletes media records with status 'pending' older than 1 hour,
 * along with their associated S3 objects.
 * Returns the number of records cleaned up.
 */
export async function cleanupPendingMedia(): Promise<number> {
  // Fetch stale pending records
  const result = await query<{ id: string; s3_key: string }>(
    `SELECT id, s3_key FROM media
     WHERE status = 'pending'
       AND uploaded_at < now() - interval '1 hour'`
  );

  if (result.rows.length === 0) return 0;

  const objectStore = await getObjectStore();

  // Delete each S3 object, ignoring individual failures so the rest still clean up
  await Promise.allSettled(
    result.rows.map(({ s3_key }) => objectStore.deleteObject(s3_key))
  );

  // Delete the DB records
  const ids = result.rows.map((r) => r.id);
  await query(
    `DELETE FROM media WHERE id = ANY($1::uuid[])`,
    [ids]
  );

  return ids.length;
}
