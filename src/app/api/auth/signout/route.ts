import { destroySession } from '@/lib/auth/session';
import { ok } from '@/lib/api/response';

export async function POST() {
  await destroySession();
  return ok({ success: true });
}
