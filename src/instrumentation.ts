/**
 * Next.js instrumentation hook — runs once on server startup.
 * Runs DB migrations, one-time cleanup tasks, and starts background workers.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Run DB migrations on every startup (idempotent — skips already-applied ones)
    try {
      const { runMigrations } = await import('./lib/migrations')
      await runMigrations()
    } catch (err) {
      console.error('[startup] Migration failed:', err)
    }

    if (process.env.NODE_ENV !== 'production') {
      // Seed default admin user if DB is empty
      try {
        const { seedDevData } = await import('./lib/seed')
        await seedDevData()
      } catch {
        // Non-fatal
      }

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

      if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_LOCAL_WORKER !== 'true') {
        const { startLocalWorker } = await import('./lib/thumbnail/localWorker')
        startLocalWorker()
      }
    }
  }
}
