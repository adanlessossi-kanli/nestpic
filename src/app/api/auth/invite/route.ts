import { NextRequest } from 'next/server';
import { getValidSession } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rateLimiter';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  // Auth guaranteed by middleware; retrieve session for userId
  const session = (await getValidSession())!;

  // Rate limit: 5 invitations per user per hour
  const allowed = await checkRateLimit(`invite:user:${session.userId}`, 5, 3600);
  if (!allowed) {
    return err('RATE_LIMIT_EXCEEDED', 'Too many invitation requests. Please try again later.', 429);
  }

  const result = await query<{ id: string; expires_at: string }>(
    `INSERT INTO invitations (created_by, expires_at)
     VALUES ($1, now() + interval '72 hours')
     RETURNING id, expires_at`,
    [session.userId]
  );

  const { id: token, expires_at } = result.rows[0];
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const inviteLink = `${baseUrl}/register/${token}`;

  return ok({ inviteLink, expiresAt: expires_at });
}
