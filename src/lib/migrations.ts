import fs from 'fs'
import path from 'path'
import pool from '@/lib/db'

/**
 * Runs all pending SQL migrations from the migrations/ directory.
 * Idempotent — already-applied migrations are skipped.
 * Called automatically on server startup via instrumentation.ts.
 */
export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  const migrationsDir = path.join(process.cwd(), 'migrations')
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file])
    if (rows.length > 0) continue

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    await pool.query(sql)
    await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file])
    console.log(`[migrations] applied ${file}`)
  }
}
