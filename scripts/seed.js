/**
 * Development seed script.
 * Creates a default admin user if no users exist.
 * Password: "password123" (bcrypt, cost 12)
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// Load .env.local in development
if (process.env.NODE_ENV !== 'production') {
  try {
    const envPath = path.join(__dirname, '..', '.env.local');
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env.local not found — rely on environment variables
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

async function run() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  const { rows } = await pool.query('SELECT COUNT(*) AS count FROM users');
  if (parseInt(rows[0].count, 10) > 0) {
    console.log('Users already exist — skipping seed.');
    await pool.end();
    return;
  }

  const hash = await bcrypt.hash('password123', 12);
  await pool.query(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)`,
    ['Admin', 'admin@example.com', hash]
  );

  console.log('Seeded user: admin@example.com / password123');
  await pool.end();
}

run().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
