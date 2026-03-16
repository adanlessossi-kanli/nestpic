import { Page, expect, Locator } from '@playwright/test'

export class InvitePage {
  readonly generateButton: Locator
  readonly inviteLink: Locator

  constructor(private page: Page) {
    this.generateButton = page.getByRole('button', { name: /Generate|Invite/ })
    this.inviteLink = page.getByRole('link', { name: /register/ })
  }

  async goto() {
    await this.page.goto('/invite')
  }

  async generateInvite(): Promise<string> {
    await this.generateButton.click()
    // The invite link is returned from the API; look for it in the page
    const linkLocator = this.page.locator('[data-testid="invite-link"], a[href*="/register/"]')
    await expect(linkLocator).toBeVisible({ timeout: 5_000 })
    const href = await linkLocator.getAttribute('href')
    return href ?? ''
  }

  async generateInviteViaAPI(page: Page): Promise<string> {
    const res = await page.request.post('/api/auth/invite')
    const json = await res.json()
    return json.inviteLink as string
  }
}

export class RegisterPage {
  constructor(private page: Page) {}

  async goto(token: string) {
    await this.page.goto(`/register/${token}`)
  }

  async expectFormVisible() {
    await expect(this.page.getByRole('button', { name: 'Create account' })).toBeVisible()
  }

  async expectExpiredError() {
    await expect(this.page.getByRole('alert')).toBeVisible()
  }

  async register(name: string, email: string, password: string) {
    await this.page.fill('#name', name)
    await this.page.fill('#email', email)
    await this.page.fill('#password', password)
    await this.page.getByRole('button', { name: 'Create account' }).click()
  }

  async expectRedirectedToFeed() {
    await this.page.waitForURL('**/feed', { timeout: 10_000 })
  }
}
