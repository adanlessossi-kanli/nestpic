import { Page, expect, Locator } from '@playwright/test'

export class AlbumsPage {
  readonly newAlbumButton: Locator
  readonly albumItems: Locator

  constructor(private page: Page) {
    this.newAlbumButton = page.getByRole('button', { name: 'New Album' })
    this.albumItems = page.locator('ul > li')
  }

  async goto() {
    await this.page.goto('/albums')
    await this.page.waitForLoadState('networkidle')
  }

  async expectLoaded() {
    await expect(this.page.getByRole('heading', { name: 'Albums' })).toBeVisible()
  }

  async createAlbum(name: string) {
    await this.newAlbumButton.click()
    await this.page.fill('input[placeholder="Album name"]', name)
    await this.page.getByRole('button', { name: 'Submit' }).click()
    // Wait for the form to close and page to refresh
    await this.page.waitForFunction(
      () => !document.querySelector('input[placeholder="Album name"]'),
      { timeout: 5_000 }
    )
  }

  async expectAlbumInList(name: string) {
    await expect(this.page.getByText(name)).toBeVisible()
  }

  async expectAlbumNotInList(name: string) {
    await expect(this.page.getByText(name)).not.toBeVisible()
  }

  async openAlbum(name: string) {
    await this.page.getByText(name).click()
    await this.page.waitForURL('**/albums/**')
  }

  async getAlbumCount() {
    return this.albumItems.count()
  }
}
