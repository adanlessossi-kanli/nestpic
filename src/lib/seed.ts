import bcrypt from 'bcrypt'
import pool from '@/lib/db'

/**
 * Seeds a default admin user if no users exist.
 * Idempotent — skips if any user is already present.
 * Only runs in development (called from instrumentation.ts).
 */
export async function seedDevData() {
  const { rows } = await pool.query('SELECT COUNT(*) AS count FROM users')
  if (parseInt(rows[0].count, 10) > 0) return

  const name     = process.env.SEED_ADMIN_NAME     ?? 'Admin'
  const email    = process.env.SEED_ADMIN_EMAIL    ?? 'admin@example.com'
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'password123'

  const hash = await bcrypt.hash(password, 12)
  await pool.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)',
    [name, email, hash]
  )
  console.log(`[seed] created admin user: ${email}`)
}
