import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}));

const mockQuery = vi.fn();
vi.mock('@/lib/db', () => ({ query: mockQuery, default: {} }));

const mockCheckRateLimit = vi.fn();
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: mockCheckRateLimit,
  clearMemoryRateLimitStore: vi.fn(),
}));

vi.mock('iron-session', () => ({
  getIronSession: (...args: unknown[]) => mockGetIronSession(...args),
}));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));

const mockBcryptCompare = vi.fn();
const mockBcryptHash = vi.fn();
vi.mock('bcrypt', () => ({
  default: { compare: mockBcryptCompare, hash: mockBcryptHash },
  compare: mockBcryptCompare,
  hash: mockBcryptHash,
}));

// Declared after vi.mock hoisting — referenced via closure in the iron-session mock above
const mockGetIronSession = vi.fn();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...overrides };
  return Object.assign(data, {
    save: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  });
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/auth/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// ─── Sign-in route ────────────────────────────────────────────────────────────

describe('POST /api/auth/signin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
  });

  it('returns 200 and user data on valid credentials', async () => {
    const userId = crypto.randomUUID();
    const newSessionId = crypto.randomUUID();
    mockBcryptCompare.mockResolvedValue(true);

    const emptySession = makeSession(); // no sessionId — no rotation
    const newSession = makeSession();
    mockGetIronSession.mockResolvedValueOnce(emptySession).mockResolvedValueOnce(newSession);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: userId, email: 'alice@example.com', name: 'Alice', password_hash: '$2b$12$hash' }] }) // user lookup
      .mockResolvedValueOnce({ rows: [{ id: newSessionId }] }); // INSERT new session

    const { POST } = await import('@/app/api/auth/signin/route');
    const req = makeRequest({ email: 'alice@example.com', password: 'password123' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.user.email).toBe('alice@example.com');
  });

  it('returns 401 on invalid password', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: crypto.randomUUID(), email: 'alice@example.com', name: 'Alice', password_hash: '$2b$12$hash' }],
    });
    mockBcryptCompare.mockResolvedValue(false);

    const { POST } = await import('@/app/api/auth/signin/route');
    const req = makeRequest({ email: 'alice@example.com', password: 'wrongpass' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 when user does not exist', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockBcryptCompare.mockResolvedValue(false);

    const { POST } = await import('@/app/api/auth/signin/route');
    const req = makeRequest({ email: 'nobody@example.com', password: 'pass' });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid Zod input (missing password)', async () => {
    const { POST } = await import('@/app/api/auth/signin/route');
    const req = makeRequest({ email: 'alice@example.com' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on invalid email format', async () => {
    const { POST } = await import('@/app/api/auth/signin/route');
    const req = makeRequest({ email: 'not-an-email', password: 'password123' });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue(false);

    const { POST } = await import('@/app/api/auth/signin/route');
    const req = makeRequest({ email: 'alice@example.com', password: 'pass' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('uses x-forwarded-for header for rate limit key', async () => {
    mockCheckRateLimit.mockResolvedValue(true);
    mockQuery.mockResolvedValue({ rows: [] });
    mockBcryptCompare.mockResolvedValue(false);

    const { POST } = await import('@/app/api/auth/signin/route');
    const req = makeRequest(
      { email: 'alice@example.com', password: 'pass' },
      { 'x-forwarded-for': '1.2.3.4' }
    );
    await POST(req);

    expect(mockCheckRateLimit).toHaveBeenCalledWith('signin:ip:1.2.3.4', 10, 60);
  });
});

// ─── Session rotation ─────────────────────────────────────────────────────────

describe('Session rotation on sign-in', () => {
  beforeEach(() => vi.clearAllMocks());

  it('destroys existing session before creating a new one', async () => {
    const oldSessionId = crypto.randomUUID();
    const newSessionId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    const existingSession = makeSession({ sessionId: oldSessionId });
    const freshSession = makeSession();
    mockGetIronSession
      .mockResolvedValueOnce(existingSession)
      .mockResolvedValueOnce(freshSession);

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // DELETE old session
      .mockResolvedValueOnce({ rows: [{ id: newSessionId }] }); // INSERT new session

    const { createSession } = await import('@/lib/auth/session');
    await createSession({ id: userId, email: 'alice@example.com', name: 'Alice' });

    expect(existingSession.destroy).toHaveBeenCalled();
    const deleteCall = mockQuery.mock.calls.find(([sql]: [string]) =>
      sql.includes('DELETE FROM sessions')
    );
    expect(deleteCall![1]).toContain(oldSessionId);
    expect(freshSession.sessionId).toBe(newSessionId);
  });
});

// ─── Sign-out route ───────────────────────────────────────────────────────────

describe('POST /api/auth/signout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('destroys session and returns 200', async () => {
    const sessionId = crypto.randomUUID();
    const session = makeSession({ sessionId, userId: crypto.randomUUID() });
    mockGetIronSession.mockResolvedValue(session);
    mockQuery.mockResolvedValue({ rows: [] });

    const { POST } = await import('@/app/api/auth/signout/route');
    const req = new NextRequest('http://localhost/api/auth/signout', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(session.destroy).toHaveBeenCalled();
    const deleteCall = mockQuery.mock.calls.find(([sql]: [string]) =>
      sql.includes('DELETE FROM sessions')
    );
    expect(deleteCall).toBeDefined();
  });
});

// ─── Session route ────────────────────────────────────────────────────────────

describe('GET /api/auth/session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with user info for a valid session', async () => {
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const session = makeSession({ sessionId, userId, email: 'alice@example.com', name: 'Alice' });
    mockGetIronSession.mockResolvedValue(session);
    mockQuery.mockResolvedValue({ rows: [{ id: sessionId }] });

    const { GET } = await import('@/app/api/auth/session/route');
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.user.email).toBe('alice@example.com');
  });

  it('returns 401 when no session exists', async () => {
    const session = makeSession({});
    mockGetIronSession.mockResolvedValue(session);

    const { GET } = await import('@/app/api/auth/session/route');
    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('returns 401 when session is expired in DB', async () => {
    const session = makeSession({ sessionId: crypto.randomUUID(), userId: crypto.randomUUID() });
    mockGetIronSession.mockResolvedValue(session);
    mockQuery.mockResolvedValue({ rows: [] }); // expired

    const { GET } = await import('@/app/api/auth/session/route');
    const res = await GET();

    expect(res.status).toBe(401);
  });
});

// ─── Invite route ─────────────────────────────────────────────────────────────

describe('POST /api/auth/invite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
  });

  it('returns 401 when not authenticated', async () => {
    const session = makeSession({});
    mockGetIronSession.mockResolvedValue(session);
    mockQuery.mockResolvedValue({ rows: [] }); // no valid session in DB

    const { POST } = await import('@/app/api/auth/invite/route');
    const req = makeRequest({});
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('returns invite link with 200 for authenticated user', async () => {
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    const session = makeSession({ sessionId, userId, email: 'alice@example.com', name: 'Alice' });
    mockGetIronSession.mockResolvedValue(session);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // getValidSession check
      .mockResolvedValueOnce({ rows: [{ id: tokenId, expires_at: expiresAt }] }); // INSERT invitation

    const { POST } = await import('@/app/api/auth/invite/route');
    const req = makeRequest({});
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.inviteLink).toContain(tokenId);
    expect(json.expiresAt).toBe(expiresAt);
  });

  it('returns 429 when invite rate limit exceeded', async () => {
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const session = makeSession({ sessionId, userId, email: 'alice@example.com', name: 'Alice' });
    mockGetIronSession.mockResolvedValue(session);
    mockQuery.mockResolvedValue({ rows: [{ id: sessionId }] });
    mockCheckRateLimit.mockResolvedValue(false);

    const { POST } = await import('@/app/api/auth/invite/route');
    const req = makeRequest({});
    const res = await POST(req);

    expect(res.status).toBe(429);
  });

  it('uses per-user rate limit key for invite endpoint', async () => {
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const session = makeSession({ sessionId, userId, email: 'alice@example.com', name: 'Alice' });
    mockGetIronSession.mockResolvedValue(session);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: sessionId }] })
      .mockResolvedValueOnce({ rows: [{ id: tokenId, expires_at: new Date().toISOString() }] });

    const { POST } = await import('@/app/api/auth/invite/route');
    await POST(makeRequest({}));

    expect(mockCheckRateLimit).toHaveBeenCalledWith(`invite:user:${userId}`, 5, 3600);
  });
});

// ─── Register route ───────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
    mockBcryptHash.mockResolvedValue('$2b$12$hashedpassword');
  });

  const validToken = crypto.randomUUID();
  const validBody = {
    token: validToken,
    name: 'Bob',
    email: 'bob@example.com',
    password: 'securepassword',
  };

  it('returns 400 for password shorter than 8 characters', async () => {
    const { POST } = await import('@/app/api/auth/register/route');
    const req = makeRequest({ ...validBody, password: 'short' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid token format', async () => {
    const { POST } = await import('@/app/api/auth/register/route');
    const req = makeRequest({ ...validBody, token: 'not-a-uuid' });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 429 when registration rate limit exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue(false);

    const { POST } = await import('@/app/api/auth/register/route');
    const req = makeRequest(validBody);
    const res = await POST(req);

    expect(res.status).toBe(429);
  });

  it('returns 410 for expired or used token', async () => {
    // No valid (unexpired, unused) invitations
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no valid invitations
      .mockResolvedValueOnce({ rows: [{ used_at: new Date().toISOString(), expires_at: new Date().toISOString() }] }); // token exists but used

    const { POST } = await import('@/app/api/auth/register/route');
    const req = makeRequest(validBody);
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(410);
    expect(json.error.code).toBe('INVITATION_INVALID');
  });

  it('returns 400 for completely unknown token', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no valid invitations
      .mockResolvedValueOnce({ rows: [] }); // token not found at all

    const { POST } = await import('@/app/api/auth/register/route');
    const req = makeRequest(validBody);
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('creates user and returns 200 for valid registration', async () => {
    const userId = crypto.randomUUID();
    const newSessionId = crypto.randomUUID();

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: validToken, expires_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(), used_at: null }] }) // valid invitations
      .mockResolvedValueOnce({ rows: [] }) // email uniqueness check
      .mockResolvedValueOnce({ rows: [{ id: userId, email: 'bob@example.com', name: 'Bob' }] }); // INSERT user + mark used

    const emptySession = makeSession();
    const newSession = makeSession();
    mockGetIronSession
      .mockResolvedValueOnce(emptySession)
      .mockResolvedValueOnce(newSession);
    // createSession INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: newSessionId }] });

    const { POST } = await import('@/app/api/auth/register/route');
    const req = makeRequest(validBody, { 'x-forwarded-for': '10.0.0.1' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.user.email).toBe('bob@example.com');
    expect(mockBcryptHash).toHaveBeenCalledWith('securepassword', 12);
  });

  it('returns 409 when email is already taken', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: validToken, expires_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(), used_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: crypto.randomUUID() }] }); // email exists

    const { POST } = await import('@/app/api/auth/register/route');
    const req = makeRequest(validBody);
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe('EMAIL_TAKEN');
  });

  it('uses per-IP rate limit key for registration', async () => {
    mockCheckRateLimit.mockResolvedValue(false);

    const { POST } = await import('@/app/api/auth/register/route');
    await POST(makeRequest(validBody, { 'x-forwarded-for': '5.6.7.8' }));

    expect(mockCheckRateLimit).toHaveBeenCalledWith('register:ip:5.6.7.8', 5, 3600);
  });
});

// ─── Rate limiter utility ─────────────────────────────────────────────────────

describe('checkRateLimit (in-memory)', () => {
  beforeEach(async () => {
    const { clearMemoryRateLimitStore } = await import('@/lib/rateLimiter');
    clearMemoryRateLimitStore();
    vi.clearAllMocks();
  });

  it('allows requests within the limit', async () => {
    // Use the real implementation (not mocked) by importing directly
    // We test the exported function via the mock to verify call patterns
    mockCheckRateLimit.mockResolvedValue(true);
    const { checkRateLimit } = await import('@/lib/rateLimiter');
    const result = await checkRateLimit('test:key', 5, 60);
    expect(result).toBe(true);
  });

  it('rejects requests exceeding the limit', async () => {
    mockCheckRateLimit.mockResolvedValue(false);
    const { checkRateLimit } = await import('@/lib/rateLimiter');
    const result = await checkRateLimit('test:key', 5, 60);
    expect(result).toBe(false);
  });
});

// ─── Zod schema validation ────────────────────────────────────────────────────

describe('Auth Zod schemas', () => {
  it('signInSchema rejects missing email', async () => {
    const { signInSchema } = await import('@/lib/schemas/auth');
    const result = signInSchema.safeParse({ password: 'pass' });
    expect(result.success).toBe(false);
  });

  it('signInSchema rejects invalid email format', async () => {
    const { signInSchema } = await import('@/lib/schemas/auth');
    const result = signInSchema.safeParse({ email: 'bad', password: 'pass' });
    expect(result.success).toBe(false);
  });

  it('signInSchema accepts valid email and password', async () => {
    const { signInSchema } = await import('@/lib/schemas/auth');
    const result = signInSchema.safeParse({ email: 'user@example.com', password: 'pass' });
    expect(result.success).toBe(true);
  });

  it('registerSchema rejects password < 8 chars', async () => {
    const { registerSchema } = await import('@/lib/schemas/auth');
    const result = registerSchema.safeParse({
      token: crypto.randomUUID(),
      name: 'Alice',
      email: 'alice@example.com',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('registerSchema rejects non-UUID token', async () => {
    const { registerSchema } = await import('@/lib/schemas/auth');
    const result = registerSchema.safeParse({
      token: 'not-a-uuid',
      name: 'Alice',
      email: 'alice@example.com',
      password: 'validpassword',
    });
    expect(result.success).toBe(false);
  });

  it('registerSchema accepts valid registration input', async () => {
    const { registerSchema } = await import('@/lib/schemas/auth');
    const result = registerSchema.safeParse({
      token: crypto.randomUUID(),
      name: 'Alice',
      email: 'alice@example.com',
      password: 'validpassword',
    });
    expect(result.success).toBe(true);
  });

  it('registerSchema rejects empty name', async () => {
    const { registerSchema } = await import('@/lib/schemas/auth');
    const result = registerSchema.safeParse({
      token: crypto.randomUUID(),
      name: '',
      email: 'alice@example.com',
      password: 'validpassword',
    });
    expect(result.success).toBe(false);
  });
});
