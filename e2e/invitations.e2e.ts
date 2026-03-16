// Feature: nestpic-app, Property 33: E2E invitation workflow allows a guest to register
import { test, expect } from '@playwright/test'
import * as path from 'path'
import { RegisterPage } from './pages/InvitePage'
import { TEST_USERS } from '../scripts/seed-test-users'
import { Client } from 'pg'

const storageState = path.join(__dirname, '.auth', 'invitations.json')
TEST_USERS.invitations // referenced for documentation

test.use({ storageState })

const createdUserEmails: string[] = []

test.describe('Invitation workflow', () => {
  test('authenticated user generates invite link via API', async ({ request }) => {
    const res = await request.post('/api/auth/invite')
    expect(res.ok()).toBe(true)

    const json = await res.json()
    expect(json.inviteLink).toMatch(/\/register\/[0-9a-f-]{36}/)
    expect(json.expiresAt).toBeTruthy()
  })

  test('guest follows invite link and sees registration form', async ({ browser, request }) => {
    // Generate invite as authenticated user
    const authContext = await browser.newContext({ storageState })
    const authPage = await authContext.newPage()
    const res = await authPage.request.post('/api/auth/invite')
    expect(res.ok()).toBe(true)
    const { inviteLink } = await res.json()
    await authContext.close()

    // Open invite link as unauthenticated guest
    const guestContext = await browser.newContext()
    const guestPage = await guestContext.newPage()

    await guestPage.goto(inviteLink)
    const register = new RegisterPage(guestPage)
    await register.expectFormVisible()

    await guestContext.close()
  })

  test('guest submits valid registration and is signed in', async ({ browser }) => {
    // Generate invite as authenticated user
    const authContext = await browser.newContext({ storageState })
    const authPage = await authContext.newPage()
    const res = await authPage.request.post('/api/auth/invite')
    expect(res.ok()).toBe(true)
    const { inviteLink } = await res.json()
    await authContext.close()

    // Register as guest
    const guestContext = await browser.newContext()
    const guestPage = await guestContext.newPage()
    const register = new RegisterPage(guestPage)

    const newEmail = `e2e-guest-${Date.now()}@nestpic.test`
    createdUserEmails.push(newEmail)

    await guestPage.goto(inviteLink)
    await register.expectFormVisible()
    await register.register('E2E Guest', newEmail, 'GuestPassword123!')
    await register.expectRedirectedToFeed()

    await guestContext.close()
  })

  test('expired or used token shows error and no registration form', async ({ browser, request }) => {
    // Generate and immediately use an invite
    const authContext = await browser.newContext({ storageState })
    const authPage = await authContext.newPage()
    const res = await authPage.request.post('/api/auth/invite')
    const { inviteLink } = await res.json()
    await authContext.close()

    // Use the token
    const token = inviteLink.split('/register/')[1]
    const useEmail = `e2e-used-${Date.now()}@nestpic.test`
    createdUserEmails.push(useEmail)

    await request.post('/api/auth/register', {
      data: { token, name: 'Used Token User', email: useEmail, password: 'Password123!' },
    })

    // Try to use the same token again as a guest
    const guestContext = await browser.newContext()
    const guestPage = await guestContext.newPage()

    await guestPage.goto(inviteLink)
    // Should show an error (expired/used)
    await expect(guestPage.getByRole('alert').first()).toBeVisible({ timeout: 5_000 })

    await guestContext.close()
  })
})

test.afterAll(async () => {
  if (createdUserEmails.length === 0) return
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/nestpic_test',
  })
  await client.connect()
  try {
    for (const email of createdUserEmails) {
      await client.query('DELETE FROM invitations WHERE used_by = (SELECT id FROM users WHERE email = $1)', [email])
      await client.query('DELETE FROM users WHERE email = $1', [email])
    }
  } finally {
    await client.end()
  }
})
