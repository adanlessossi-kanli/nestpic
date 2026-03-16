import 'server-only';
import { getIronSession, IronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

export interface SessionData {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
}

const SESSION_OPTIONS = {
  password: process.env.SESSION_SECRET as string,
  cookieName: 'nestpic_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS);
}

/**
 * Creates a new session for the given user, rotating any existing session first.
 * Only rotates if the existing session belongs to the same user (prevents cross-user deletion).
 * Writes a record to the sessions table with expires_at = now + 7 days.
 */
export async function createSession(user: {
  id: string;
  email: string;
  name: string;
}): Promise<void> {
  // Session rotation: destroy any existing session before creating a new one,
  // but only if it belongs to the same user (prevents deleting another user's session)
  const session = await getSession();
  if (session.sessionId && session.userId === user.id) {
    await query('DELETE FROM sessions WHERE id = $1', [session.sessionId]);
    await session.destroy();
  }

  // Create DB session record
  const result = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, expires_at)
     VALUES ($1, now() + interval '7 days')
     RETURNING id`,
    [user.id]
  );
  const sessionId = result.rows[0].id;

  // Populate and save the iron-session cookie
  const newSession = await getSession();
  newSession.sessionId = sessionId;
  newSession.userId = user.id;
  newSession.email = user.email;
  newSession.name = user.name;
  await newSession.save();
}

/**
 * Destroys the current session: deletes the DB record and clears the cookie.
 */
export async function destroySession(): Promise<void> {
  const session = await getSession();
  if (session.sessionId) {
    await query('DELETE FROM sessions WHERE id = $1', [session.sessionId]);
  }
  await session.destroy();
}

/**
 * Returns the current session data if the session is valid (exists in DB and not expired),
 * or null if unauthenticated.
 */
export async function getValidSession(): Promise<SessionData | null> {
  const session = await getSession();
  if (!session.sessionId || !session.userId) return null;

  const result = await query<{ id: string }>(
    'SELECT id FROM sessions WHERE id = $1 AND expires_at > now()',
    [session.sessionId]
  );
  if (result.rows.length === 0) {
    await session.destroy();
    return null;
  }

  return {
    sessionId: session.sessionId,
    userId: session.userId,
    email: session.email,
    name: session.name,
  };
}
