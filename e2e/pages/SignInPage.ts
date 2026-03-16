import { Page, expect } from '@playwright/test'

export class SignInPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/signin')
  }

  async signIn(email: string, password: string) {
    await this.page.fill('#email', email)
    await this.page.fill('#password', password)
    await this.page.click('button[type="submit"]')
  }

  async expectError() {
    await expect(this.page.getByRole('alert')).toBeVisible()
  }

  async expectRedirectedToFeed() {
    await this.page.waitForURL('**/feed')
  }
}
