import { Page, expect, Locator } from '@playwright/test'
import * as path from 'path'

export class UploadModal {
  readonly dialog: Locator
  readonly fileInput: Locator
  readonly uploadButton: Locator
  readonly cancelButton: Locator
  readonly progressBar: Locator
  readonly errorAlert: Locator

  constructor(private page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Upload Media' })
    this.fileInput = this.dialog.locator('input[type="file"]')
    this.uploadButton = this.dialog.getByRole('button', { name: 'Upload', exact: true })
    this.cancelButton = this.dialog.getByRole('button', { name: 'Cancel' })
    this.progressBar = page.getByLabel(/Upload progress/)
    this.errorAlert = this.dialog.getByRole('alert')
  }

  async expectVisible() {
    await expect(this.dialog).toBeVisible()
  }

  async selectFile(filePath: string) {
    await this.fileInput.setInputFiles(filePath)
  }

  async selectTestImage() {
    // Use a minimal 1x1 JPEG for testing
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'test-image.jpg')
    await this.fileInput.setInputFiles(fixturePath)
  }

  async clickUpload() {
    await this.uploadButton.click()
  }

  async waitForProgress() {
    await expect(this.progressBar).toBeVisible({ timeout: 10_000 })
  }

  async waitForCompletion() {
    // Dialog closes on success
    await expect(this.dialog).not.toBeVisible({ timeout: 30_000 })
  }

  async close() {
    await this.cancelButton.click()
  }
}
