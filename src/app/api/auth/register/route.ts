import { NextRequest } from 'next/server';
import bcrypt from 'bcrypt';
import { timingSafeEqual } from 'crypto';
import { query } from '@/lib/db';
import { createSession } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rateLimiter';
import { registerSchema } from '@/lib/schemas/auth';
import { ok, err } from '@/lib/api/response';

const BCRYPT_COST = 12;

export async function POST(request: NextRequest) {
  // Rate limit: 5 registration attempts per IP per hour
  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
  const allowed = await checkRateLimit(`register:ip:${ip}`, 5, 3600);
  if (!allowed) {
    return err('RATE_LIMIT_EXCEEDED', 'Too many registration attempts. Please try again later.', 429);
  }

  // Validate body
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  const { token, name, email, password } = parsed.data;

  // Look up invitation using constant-time comparison
  const invResult = await query<{
    id: string;
    expires_at: string;
    used_at: string | null;
  }>(
    'SELECT id, expires_at, used_at FROM invitations WHERE expires_at > now() AND used_at IS NULL',
    []
  );

  const invitation = invResult.rows.find((row) => {
    try {
      const a = Buffer.from(row.id.replace(/-/g, ''), 'hex');
      const b = Buffer.from(token.replace(/-/g, ''), 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });

  if (!invitation) {
    // Check if token exists but is expired/used (return 410)
    const anyResult = await query<{ used_at: string | null; expires_at: string }>(
      'SELECT used_at, expires_at FROM invitations WHERE id = $1',
      [token]
    );
    if (anyResult.rows.length > 0) {
      return err('INVITATION_INVALID', 'This invitation has expired or has already been used', 410);
    }
    return err('INVITATION_INVALID', 'Invalid invitation token', 400);
  }

  // Check email uniqueness
  const existingUser = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser.rows.length > 0) {
    return err('EMAIL_TAKEN', 'An account with this email already exists', 409);
  }

  // Hash password with bcrypt cost factor >= 12
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // Create user and mark invitation as used in a transaction
  const userResult = await query<{ id: string; email: string; name: string }>(
    `WITH new_user AS (
       INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, name
     ),
     mark_used AS (
       UPDATE invitations
       SET used_by = (SELECT id FROM new_user), used_at = now()
       WHERE id = $4
     )
     SELECT id, email, name FROM new_user`,
    [name, email, passwordHash, invitation.id]
  );

  const user = userResult.rows[0];
  await createSession({ id: user.id, email: user.email, name: user.name });

  return ok({ user: { id: user.id, email: user.email, name: user.name } });
}
