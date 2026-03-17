import { Page, expect, Locator } from '@playwright/test'
import * as path from 'path'

export class UploadModal {
  readonly dialog: Locator
  readonly fileInput: Locator
  readonly uploadButton: Locator
  readonly cancelButton: Locator
  readonly progressBar: Locator
  readonly errorAlert: Locator
  readonly labelInput: Locator
  readonly categorySelect: Locator
  readonly newCategoryInput: Locator

  constructor(private page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Upload Media' })
    this.fileInput = this.dialog.locator('input[type="file"]')
    this.uploadButton = this.dialog.getByRole('button', { name: 'Upload', exact: true })
    this.cancelButton = this.dialog.getByRole('button', { name: 'Cancel' })
    this.progressBar = page.getByLabel(/Upload progress/)
    this.errorAlert = this.dialog.getByRole('alert')
    this.labelInput = this.dialog.locator('#upload-label')
    this.categorySelect = this.dialog.locator('#upload-category')
    this.newCategoryInput = this.dialog.locator('#upload-new-category')
  }

  async expectVisible() {
    await expect(this.dialog).toBeVisible()
  }

  async selectFile(filePath: string) {
    await this.fileInput.setInputFiles(filePath)
  }

  async selectTestVideo() {
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'test-video.mp4')
    await this.fileInput.setInputFiles(fixturePath)
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

  async fillLabel(label: string) {
    await this.labelInput.fill(label)
  }

  /** Select an existing category by name from the dropdown. */
  async selectExistingCategory(name: string) {
    await this.categorySelect.selectOption({ label: name })
  }

  /** Choose "New category…" and type a new category name. */
  async createNewCategory(name: string) {
    await this.categorySelect.selectOption('__new__')
    await expect(this.newCategoryInput).toBeVisible()
    await this.newCategoryInput.fill(name)
  }
}
