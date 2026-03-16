// Feature: nestpic-app, Property 27: E2E authentication workflow completes successfully
import { test, expect } from '@playwright/test'
import * as path from 'path'
import { SignInPage } from './pages/SignInPage'
import { TEST_USERS } from '../scripts/seed-test-users'

const storageState = path.join(__dirname, '.auth', 'auth.json')
const user = TEST_USERS.auth

test.describe('Authentication workflow', () => {
  test('sign-in with valid credentials redirects to feed', async ({ page }) => {
    const signIn = new SignInPage(page)
    await signIn.goto()
    await signIn.signIn(user.email, user.password)
    await signIn.expectRedirectedToFeed()
    await expect(page.getByRole('heading', { name: 'Family Feed' })).toBeVisible()
  })

  test('sign-in with invalid credentials shows error and no session', async ({ page }) => {
    const signIn = new SignInPage(page)
    await signIn.goto()
    await signIn.signIn(user.email, 'wrong-password')
    await signIn.expectError()
    // Still on sign-in page
    await expect(page).toHaveURL(/\/signin/)
  })

  test('sign-out redirects to sign-in page', async ({ browser }) => {
    const context = await browser.newContext({ storageState })
    const page = await context.newPage()

    await page.goto('/feed')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Family Feed' })).toBeVisible()

    // Sign out via nav button
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL('**/signin')
    await expect(page).toHaveURL(/\/signin/)

    await context.close()
  })

  test('unauthenticated navigation to protected route redirects to sign-in', async ({ page }) => {
    await page.goto('/feed')
    await page.waitForURL('**/signin')
    await expect(page).toHaveURL(/\/signin/)
  })

  test('unauthenticated access to /albums redirects to sign-in', async ({ page }) => {
    await page.goto('/albums')
    await page.waitForURL('**/signin')
    await expect(page).toHaveURL(/\/signin/)
  })
})
