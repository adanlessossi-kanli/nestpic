// Feature: nestpic-app, Property 28: E2E upload workflow surfaces media in the feed
import { test, expect } from '@playwright/test'
import * as path from 'path'
import { FeedPage } from './pages/FeedPage'
import { UploadModal } from './pages/UploadModal'
import { TEST_USERS } from '../scripts/seed-test-users'

const storageState = path.join(__dirname, '.auth', 'upload.json')
const user = TEST_USERS.upload

// Track uploaded media IDs for cleanup
const uploadedMediaIds: string[] = []

test.use({ storageState })

test.describe('Media upload workflow', () => {
  test('file selection, upload progress, and media appears in feed', async ({ page }) => {
    const feed = new FeedPage(page)
    const modal = new UploadModal(page)

    await feed.goto()
    await feed.expectLoaded()

    const countBefore = await feed.getMediaCount()

    // Open upload modal
    await feed.openUploadModal()
    await modal.expectVisible()

    // Select test image
    await modal.selectTestImage()

    // Fill in label and create a new category
    const testLabel = 'E2E test label'
    const testCategory = `e2e-category-${Date.now()}`
    await modal.fillLabel(testLabel)
    await modal.createNewCategory(testCategory)

    // Capture confirm response to assert label and category are persisted
    let confirmedMedia: { label?: string | null; category?: string | null; id?: string } = {}
    page.on('response', async (response) => {
      if (response.url().includes('/api/upload/confirm') && response.status() === 200) {
        const json = await response.json().catch(() => null)
        if (json?.media) {
          confirmedMedia = json.media
          if (json.media.id) uploadedMediaIds.push(json.media.id)
        }
      }
    })

    // Start upload
    await modal.clickUpload()

    // Progress should appear
    await modal.waitForProgress()

    // Modal closes on success
    await modal.waitForCompletion()

    // Assert label and category are returned in the confirm response
    expect(confirmedMedia.label).toBe(testLabel)
    expect(confirmedMedia.category).toBe(testCategory)

    // New item should appear in feed (prepended)
    await expect(async () => {
      const countAfter = await feed.getMediaCount()
      expect(countAfter).toBeGreaterThan(countBefore)
    }).toPass({ timeout: 10_000 })
  })

  test('unsupported file type shows error and does not upload', async ({ page }) => {
    const feed = new FeedPage(page)
    const modal = new UploadModal(page)

    await feed.goto()
    await feed.openUploadModal()

    // Set a .txt file (unsupported)
    const txtPath = path.join(__dirname, 'fixtures', 'test-file.txt')
    // Create a buffer-based file via page.evaluate workaround — use setInputFiles with type override
    await page.evaluate(() => {
      // Override file input accept to allow txt for this test
    })
    // Use a data transfer to set an unsupported MIME type
    await page.locator('input[type="file"]').evaluate((input: HTMLInputElement) => {
      const file = new File(['hello'], 'test.txt', { type: 'text/plain' })
      const dt = new DataTransfer()
      dt.items.add(file)
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await expect(modal.errorAlert).toBeVisible()
    await expect(modal.uploadButton).toBeDisabled()
  })
})

test.afterAll(async ({ request }) => {
  // Clean up uploaded media
  for (const id of uploadedMediaIds) {
    await request.delete(`/api/media/${id}`).catch(() => {})
  }
})
