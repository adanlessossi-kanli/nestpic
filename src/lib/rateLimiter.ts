import { query } from '@/lib/db';

// In-memory LRU for local dev (avoids DB dependency during development)
interface Bucket {
  count: number;
  windowStart: number;
}
const memoryStore = new Map<string, Bucket>();

/**
 * Checks whether the given key has exceeded the rate limit.
 * Uses the rate_limit_buckets table in production and an in-memory store in development.
 *
 * @returns true if the request is allowed, false if the limit is exceeded.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') {
    return checkMemoryRateLimit(key, maxRequests, windowSeconds);
  }
  return checkDbRateLimit(key, maxRequests, windowSeconds);
}

function checkMemoryRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): boolean {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const bucket = memoryStore.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    memoryStore.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= maxRequests) {
    return false;
  }

  bucket.count += 1;
  return true;
}

async function checkDbRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  // Upsert: if the window has expired, reset; otherwise increment
  const result = await query<{ count: number; window_start: Date }>(
    `INSERT INTO rate_limit_buckets (key, count, window_start)
     VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE
       SET count = CASE
             WHEN rate_limit_buckets.window_start + ($3 * interval '1 second') <= now()
             THEN 1
             ELSE rate_limit_buckets.count + 1
           END,
           window_start = CASE
             WHEN rate_limit_buckets.window_start + ($3 * interval '1 second') <= now()
             THEN now()
             ELSE rate_limit_buckets.window_start
           END
     RETURNING count, window_start`,
    [key, maxRequests, windowSeconds]
  );

  const { count } = result.rows[0];
  return count <= maxRequests;
}

/** Clears the in-memory store — useful in tests. */
export function clearMemoryRateLimitStore(): void {
  memoryStore.clear();
}
