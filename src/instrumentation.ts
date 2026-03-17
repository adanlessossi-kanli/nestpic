/**
 * Next.js instrumentation hook — runs once on server startup.
 * Used to perform one-time cleanup tasks in development.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV !== 'production') {
    try {
      const { default: pool } = await import('@/lib/db')
      // Fix any thumbnail_key values that incorrectly point to the originals/ prefix.
      // These were written by an early version of the thumbnail worker.
      await pool.query(
        "UPDATE media SET thumbnail_key = NULL WHERE thumbnail_key IS NOT NULL AND thumbnail_key NOT LIKE 'thumbnails/%'"
      )
    } catch {
      // Non-fatal — DB may not be available yet on first boot
    }
  }
}
