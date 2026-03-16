import { getValidSession } from '@/lib/auth/session';
import { ok, err } from '@/lib/api/response';

export async function GET() {
  const session = await getValidSession();
  if (!session) {
    return err('UNAUTHORIZED', 'Not authenticated', 401);
  }
  return ok({ user: { id: session.userId, email: session.email, name: session.name } });
}
