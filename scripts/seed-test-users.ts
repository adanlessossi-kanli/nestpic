/**
 * Playwright global setup: seeds test users and saves authenticated browser state.
 * One Test_User per E2E test file for isolation.
 */
import { chromium, FullConfig } from '@playwright/test'
import { Client } from 'pg'
import * as bcrypt from 'bcrypt'
import * as fs from 'fs'
import * as path from 'path'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/nestpic'
const BASE_URL = 'http://localhost:3000'
const AUTH_DIR = path.join(__dirname, '..', 'e2e', '.auth')

export const TEST_USERS = {
  auth: {
    email: 'test-auth@nestpic.test',
    password: 'TestPassword123!',
    name: 'Auth Test User',
  },
  upload: {
    email: 'test-upload@nestpic.test',
    password: 'TestPassword123!',
    name: 'Upload Test User',
  },
  feed: {
    email: 'test-feed@nestpic.test',
    password: 'TestPassword123!',
    name: 'Feed Test User',
  },
  albums: {
    email: 'test-albums@nestpic.test',
    password: 'TestPassword123!',
    name: 'Albums Test User',
  },
  mediaViewing: {
    email: 'test-media-viewing@nestpic.test',
    password: 'TestPassword123!',
    name: 'Media Viewing Test User',
  },
  deletion: {
    email: 'test-deletion@nestpic.test',
    password: 'TestPassword123!',
    name: 'Deletion Test User',
  },
  invitations: {
    email: 'test-invitations@nestpic.test',
    password: 'TestPassword123!',
    name: 'Invitations Test User',
  },
} as const

export type TestUserKey = keyof typeof TEST_USERS

async function seedUsers(client: Client) {
  for (const [, user] of Object.entries(TEST_USERS)) {
    const hash = await bcrypt.hash(user.password, 12)
    await client.query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash`,
      [user.email, user.name, hash]
    )
  }
}

async function saveAuthState(
  userKey: TestUserKey,
  user: { email: string; password: string }
) {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/signin`)
  await page.fill('#email', user.email)
  await page.fill('#password', user.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE_URL}/feed`, { timeout: 15_000 })

  const stateFile = path.join(AUTH_DIR, `${userKey}.json`)
  await context.storageState({ path: stateFile })
  await browser.close()
}

export default async function globalSetup(_config: FullConfig) {
  // Ensure auth directory exists
  fs.mkdirSync(AUTH_DIR, { recursive: true })

  // Seed users in DB
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    await seedUsers(client)
  } finally {
    await client.end()
  }

  // Save authenticated state for each test user
  for (const [key, user] of Object.entries(TEST_USERS) as [TestUserKey, typeof TEST_USERS[TestUserKey]][]) {
    await saveAuthState(key, user)
  }
}
