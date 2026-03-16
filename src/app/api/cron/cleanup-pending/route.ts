import { NextRequest } from 'next/server';
import { cleanupPendingMedia } from '@/lib/upload/cleanupPending';
import { ok, err } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return err('FORBIDDEN', 'Invalid or missing cron secret', 403);
  }

  const cleaned = await cleanupPendingMedia();
  return ok({ cleaned });
}
