import { NextRequest } from 'next/server';
import bcrypt from 'bcrypt';
import { query } from '@/lib/db';
import { createSession } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rateLimiter';
import { signInSchema } from '@/lib/schemas/auth';
import { ok, err } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  // Rate limit: 10 requests per IP per minute
  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
  const allowed = await checkRateLimit(`signin:ip:${ip}`, 10, 60);
  if (!allowed) {
    return err('RATE_LIMIT_EXCEEDED', 'Too many sign-in attempts. Please try again later.', 429);
  }

  // Validate body
  const body = await request.json().catch(() => null);
  const parsed = signInSchema.safeParse(body);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  const { email, password } = parsed.data;

  // Look up user
  const result = await query<{ id: string; email: string; name: string; password_hash: string }>(
    'SELECT id, email, name, password_hash FROM users WHERE email = $1',
    [email]
  );

  const user = result.rows[0];

  // Use a dummy hash to prevent timing attacks when user doesn't exist
  const hashToCompare = user?.password_hash ?? '$2b$12$invalidhashfortimingprotection000000000000000000000000';
  const passwordMatch = await bcrypt.compare(password, hashToCompare);

  if (!user || !passwordMatch) {
    return err('INVALID_CREDENTIALS', 'Invalid email or password', 401);
  }

  await createSession({ id: user.id, email: user.email, name: user.name });

  return ok({ user: { id: user.id, email: user.email, name: user.name } });
}
