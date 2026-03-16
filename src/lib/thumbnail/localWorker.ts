import 'server-only';
import { query } from '@/lib/db';
import { processMedia } from './processor';

const POLL_INTERVAL_MS = 5000;

async function pollPendingThumbnails(): Promise<void> {
  const result = await query<{ id: string; s3_key: string; content_type: string }>(
    `SELECT id, s3_key, content_type FROM media WHERE status = 'active' AND thumbnail_key IS NULL LIMIT 10`
  );

  for (const row of result.rows) {
    try {
      await processMedia(row.id, row.s3_key, row.content_type);
    } catch (err) {
      console.error(`[localWorker] Failed to process media ${row.id}:`, err);
    }
  }
}

export function startLocalWorker(): void {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  console.log('[localWorker] Starting local thumbnail worker (polling every 5s)');

  const tick = async () => {
    try {
      await pollPendingThumbnails();
    } catch (err) {
      console.error('[localWorker] Poll error:', err);
    } finally {
      setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  setTimeout(tick, POLL_INTERVAL_MS);
}
