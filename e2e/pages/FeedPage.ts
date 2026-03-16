import { Page, expect, Locator } from '@playwright/test'

export class FeedPage {
  readonly uploadButton: Locator
  readonly mediaCards: Locator

  constructor(private page: Page) {
    this.uploadButton = page.getByRole('button', { name: 'Upload' })
    this.mediaCards = page.locator('.grid > div')
  }

  async goto() {
    await this.page.goto('/feed')
  }

  async expectLoaded() {
    await expect(this.page.getByRole('heading', { name: 'Family Feed' })).toBeVisible()
  }

  async openUploadModal() {
    await this.uploadButton.click()
    await expect(this.page.getByRole('dialog', { name: 'Upload Media' })).toBeVisible()
  }

  async clickFirstMediaItem() {
    await this.mediaCards.first().getByRole('button').click()
  }

  async scrollToBottom() {
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  }

  async waitForMoreItems(previousCount: number) {
    await this.page.waitForFunction(
      (count) => document.querySelectorAll('.grid > div').length > count,
      previousCount,
      { timeout: 10_000 }
    )
  }

  async getMediaCount() {
    return this.mediaCards.count()
  }

  async clickDeleteOnFirstOwnedItem() {
    await this.page.getByRole('button', { name: /Delete media/ }).first().click()
  }

  async confirmDelete() {
    await this.page.getByRole('dialog', { name: 'Delete media?' }).waitFor()
    await this.page.getByRole('button', { name: 'Delete' }).click()
  }

  async cancelDelete() {
    await this.page.getByRole('button', { name: 'Cancel' }).click()
  }

  async signOut() {
    await this.page.getByRole('button', { name: 'Sign out' }).click()
  }
}
