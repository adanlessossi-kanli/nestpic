import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateConfig, REQUIRED_ENV_VARS } from '@/lib/objectStore/index';

const VALID_CONFIG = {
  OBJECT_STORE_ENDPOINT: 'http://localhost:8080',
  OBJECT_STORE_ACCESS_KEY: 'access-key',
  OBJECT_STORE_SECRET_KEY: 'secret-key',
  OBJECT_STORE_BUCKET: 'nestpic',
};

describe('ObjectStore configuration properties', () => {
  // Feature: nestpic-app, Property 25: Object store is configured from environment variables
  it('Property 25: factory produces an instance configured with exactly the provided env vars', () => {
    fc.assert(
      fc.property(
        fc.record({
          OBJECT_STORE_ENDPOINT: fc.webUrl(),
          OBJECT_STORE_ACCESS_KEY: fc.string({ minLength: 1, maxLength: 64 }),
          OBJECT_STORE_SECRET_KEY: fc.string({ minLength: 1, maxLength: 64 }),
          OBJECT_STORE_BUCKET: fc.string({ minLength: 1, maxLength: 63 }),
        }),
        (vars) => {
          const config = validateConfig(vars);

          expect(config.endpoint).toBe(vars.OBJECT_STORE_ENDPOINT);
          expect(config.accessKey).toBe(vars.OBJECT_STORE_ACCESS_KEY);
          expect(config.secretKey).toBe(vars.OBJECT_STORE_SECRET_KEY);
          expect(config.bucket).toBe(vars.OBJECT_STORE_BUCKET);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: nestpic-app, Property 26: Missing environment variables prevent startup
  it('Property 26: missing any required env var throws a descriptive error', () => {
    fc.assert(
      fc.property(
        // Pick a non-empty subset of required vars to omit
        fc.subarray(Array.from(REQUIRED_ENV_VARS), { minLength: 1 }),
        (missingKeys) => {
          const vars: Record<string, string | undefined> = { ...VALID_CONFIG };
          for (const key of missingKeys) {
            delete vars[key];
          }

          expect(() => validateConfig(vars)).toThrow();

          // Error message must mention at least one of the missing keys
          try {
            validateConfig(vars);
          } catch (err) {
            const message = (err as Error).message;
            const mentionsAMissingKey = missingKeys.some((k) => message.includes(k));
            expect(mentionsAMissingKey).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 26: empty string values for required vars are treated as missing', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REQUIRED_ENV_VARS),
        (emptyKey) => {
          const vars: Record<string, string | undefined> = {
            ...VALID_CONFIG,
            [emptyKey]: '',
          };

          expect(() => validateConfig(vars)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 25: optional CDN vars are passed through when present', () => {
    fc.assert(
      fc.property(
        fc.record({
          CDN_BASE_URL: fc.webUrl(),
          CDN_KEY_PAIR_ID: fc.string({ minLength: 1, maxLength: 32 }),
          CDN_PRIVATE_KEY: fc.string({ minLength: 1, maxLength: 256 }),
        }),
        (cdnVars) => {
          const vars = { ...VALID_CONFIG, ...cdnVars };
          const config = validateConfig(vars);

          expect(config.cdnBaseUrl).toBe(cdnVars.CDN_BASE_URL);
          expect(config.cdnKeyPairId).toBe(cdnVars.CDN_KEY_PAIR_ID);
          expect(config.cdnPrivateKey).toBe(cdnVars.CDN_PRIVATE_KEY);
        }
      ),
      { numRuns: 100 }
    );
  });
});
