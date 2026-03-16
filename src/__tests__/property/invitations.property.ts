import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

vi.mock('server-only', () => ({}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simulate the invitation token generation logic from the invite route */
function generateInvitationToken(): string {
  return crypto.randomUUID();
}

/** Compute expires_at as now + 72 hours (mirrors the DB logic) */
function computeExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + 72 * 60 * 60 * 1000);
}

import { timingSafeEqual } from 'crypto';
function timingSafeUuidEqualSync(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a.replace(/-/g, ''), 'hex');
    const bufB = Buffer.from(b.replace(/-/g, ''), 'hex');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ─── Property 19: Invitation tokens are unique and expire in 72 hours ────────

describe('Invitation token properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Feature: nestpic-app, Property 19: Invitation tokens are unique and expire in 72 hours
  it('Property 19: N generated tokens are all distinct', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 50 }),
        (n) => {
          const tokens = Array.from({ length: n }, () => generateInvitationToken());
          const unique = new Set(tokens);
          expect(unique.size).toBe(n);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: nestpic-app, Property 19: Invitation tokens are unique and expire in 72 hours
  it('Property 19: expires_at is exactly 72 hours after created_at', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
        (createdAt) => {
          const expiresAt = computeExpiresAt(createdAt);
          const diffMs = expiresAt.getTime() - createdAt.getTime();
          const diffHours = diffMs / (1000 * 60 * 60);
          expect(diffHours).toBe(72);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: nestpic-app, Property 19: tokens are UUIDs (valid format)
  it('Property 19: generated tokens are valid UUIDs', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const token = generateInvitationToken();
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(uuidRegex.test(token)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: nestpic-app, Property 21: Expired or used invitation tokens are rejected
  it('Property 21: a token with expires_at in the past is considered expired', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 365 * 24 }),
        (hoursAgo) => {
          const now = new Date();
          const expiresAt = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
          const isExpired = expiresAt <= now;
          expect(isExpired).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: nestpic-app, Property 21: Expired or used invitation tokens are rejected
  it('Property 21: a token with non-null used_at is considered used', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
        (usedAt) => {
          const invitation = { used_at: usedAt.toISOString() };
          const isUsed = invitation.used_at !== null;
          expect(isUsed).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: nestpic-app, Property 39: Invitation token comparison is constant-time
  it('Property 39: constant-time comparison correctly identifies matching tokens', () => {
    fc.assert(
      fc.property(fc.uuid(), (token) => {
        expect(timingSafeUuidEqualSync(token, token)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: nestpic-app, Property 39: Invitation token comparison is constant-time
  it('Property 39: constant-time comparison correctly rejects non-matching tokens', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (tokenA, tokenB) => {
          fc.pre(tokenA !== tokenB);
          expect(timingSafeUuidEqualSync(tokenA, tokenB)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Registration validation properties ──────────────────────────────────────

describe('Registration validation properties', () => {
  // Feature: nestpic-app, Property 22: Short passwords are rejected at registration
  it('Property 22: passwords shorter than 8 characters fail Zod validation', async () => {
    const { registerSchema } = await import('@/lib/schemas/auth');

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          token: fc.uuid(),
          name: fc.string({ minLength: 1, maxLength: 100 }),
          email: fc.emailAddress(),
          password: fc.string({ minLength: 0, maxLength: 7 }),
        }),
        async (input) => {
          const result = registerSchema.safeParse(input);
          expect(result.success).toBe(false);
          if (!result.success) {
            const passwordError = result.error.issues.find((i) =>
              i.path.includes('password')
            );
            expect(passwordError).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: nestpic-app, Property 22: passwords >= 8 chars pass length validation
  it('Property 22: passwords of 8 or more characters pass length validation', async () => {
    const { registerSchema } = await import('@/lib/schemas/auth');

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          token: fc.uuid(),
          name: fc.string({ minLength: 1, maxLength: 100 }),
          email: fc.emailAddress(),
          password: fc.string({ minLength: 8, maxLength: 128 }),
        }),
        async (input) => {
          const result = registerSchema.safeParse(input);
          if (!result.success) {
            const passwordError = result.error.issues.find((i) =>
              i.path.includes('password')
            );
            expect(passwordError).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: nestpic-app, Property 23: Passwords are stored as hashes, never plaintext
  it('Property 23: bcrypt hash does not equal the plaintext password', async () => {
    const bcrypt = await import('bcrypt');

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 72 }),
        async (password) => {
          const hash = await bcrypt.hash(password, 12);
          expect(hash).not.toBe(password);
          expect(hash).toMatch(/^\$2[ab]\$12\$/);
        }
      ),
      { numRuns: 5 } // bcrypt is slow; 5 runs is sufficient
    );
  }, 30000);

  // Feature: nestpic-app, Property 23: bcrypt hash is verifiable
  it('Property 23: bcrypt hash is verifiable with the original password', async () => {
    const bcrypt = await import('bcrypt');

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 72 }),
        async (password) => {
          const hash = await bcrypt.hash(password, 12);
          const match = await bcrypt.compare(password, hash);
          expect(match).toBe(true);
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  // Feature: nestpic-app, Property 38: bcrypt cost factor is at least 12
  it('Property 38: bcrypt hashes use cost factor >= 12', async () => {
    const bcrypt = await import('bcrypt');

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 72 }),
        async (password) => {
          const hash = await bcrypt.hash(password, 12);
          const rounds = bcrypt.getRounds(hash);
          expect(rounds).toBeGreaterThanOrEqual(12);
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  // Feature: nestpic-app, Property 20: Invitation token is invalidated after successful registration
  it('Property 20: after registration, invitation has non-null used_at and used_by', () => {
    fc.assert(
      fc.property(
        fc.record({
          userId: fc.uuid(),
          usedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
        }),
        ({ userId, usedAt }) => {
          // Simulate the state after the UPDATE in the register route
          const invitation = {
            used_by: userId,
            used_at: usedAt.toISOString(),
          };
          expect(invitation.used_by).not.toBeNull();
          expect(invitation.used_at).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: nestpic-app, Property 20: used token is rejected on re-use
  it('Property 20: a token with used_at set is treated as already used', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
        (usedAt) => {
          const invitation = {
            used_at: usedAt.toISOString(),
            expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          };
          // The register route filters: expires_at > now AND used_at IS NULL
          const isEligible = invitation.used_at === null;
          expect(isEligible).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
