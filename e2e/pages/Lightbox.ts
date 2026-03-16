import { Page, expect, Locator } from '@playwright/test'

export class LightboxPage {
  readonly dialog: Locator
  readonly closeButton: Locator
  readonly prevButton: Locator
  readonly nextButton: Locator

  constructor(private page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Media lightbox' })
    this.closeButton = page.getByRole('button', { name: 'Close lightbox' })
    this.prevButton = page.getByRole('button', { name: 'Previous media' })
    this.nextButton = page.getByRole('button', { name: 'Next media' })
  }

  async expectVisible() {
    await expect(this.dialog).toBeVisible()
  }

  async expectNotVisible() {
    await expect(this.dialog).not.toBeVisible()
  }

  async close() {
    await this.closeButton.click()
  }

  async goNext() {
    await this.nextButton.click()
  }

  async goPrev() {
    await this.prevButton.click()
  }

  async expectNextVisible() {
    await expect(this.nextButton).toBeVisible()
  }

  async expectPrevVisible() {
    await expect(this.prevButton).toBeVisible()
  }
}

export class VideoPlayerPage {
  readonly dialog: Locator
  readonly closeButton: Locator
  readonly video: Locator
  readonly prevButton: Locator
  readonly nextButton: Locator

  constructor(private page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Video player' })
    this.closeButton = page.getByRole('button', { name: 'Close video player' })
    this.video = page.locator('video')
    this.prevButton = page.getByRole('button', { name: 'Previous media' })
    this.nextButton = page.getByRole('button', { name: 'Next media' })
  }

  async expectVisible() {
    await expect(this.dialog).toBeVisible()
  }

  async expectVideoHasControls() {
    await expect(this.video).toHaveAttribute('controls', '')
  }

  async close() {
    await this.closeButton.click()
  }
}
