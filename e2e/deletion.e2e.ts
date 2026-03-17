// Feature: nestpic-app, Property 32: E2E deletion workflow removes media from the feed
import { test, expect } from '@playwright/test'
import * as path from 'path'
import { FeedPage } from './pages/FeedPage'
import { UploadModal } from './pages/UploadModal'
import { TEST_USERS } from '../scripts/seed-test-users'

const storageState = path.join(__dirname, '.auth', 'deletion.json')
TEST_USERS.deletion // referenced for documentation

test.use({ storageState })

test.describe('Media deletion workflow', () => {
  test('delete confirmation prompt appears and confirmed deletion removes item from feed', async ({ page }) => {
    const feed = new FeedPage(page)
    const modal = new UploadModal(page)

    await feed.goto()
    await feed.expectLoaded()

    // Upload a media item first so we have something to delete
    await feed.openUploadModal()
    await modal.selectTestImage()
    await modal.clickUpload()
    await modal.waitForCompletion()

    // Wait for the new item to appear
    await page.waitForTimeout(1000)
    await page.reload()
    await feed.expectLoaded()

    const countBefore = await feed.getMediaCount()
    expect(countBefore).toBeGreaterThan(0)

    // Click delete on the first owned item
    const deleteButton = page.getByRole('button', { name: /Delete media/ }).first()
    await expect(deleteButton).toBeVisible()
    await deleteButton.click()

    // Confirmation dialog should appear
    const dialog = page.getByRole('dialog', { name: 'Delete media?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/permanently remove/i)).toBeVisible()

    // Confirm deletion
    await dialog.getByRole('button', { name: 'Delete' }).click()

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5_000 })

    // Item count should decrease
    await expect(async () => {
      const countAfter = await feed.getMediaCount()
      expect(countAfter).toBeLessThan(countBefore)
    }).toPass({ timeout: 5_000 })
  })

  test('cancelling delete confirmation keeps item in feed', async ({ page }) => {
    const feed = new FeedPage(page)
    const modal = new UploadModal(page)

    await feed.goto()
    await feed.expectLoaded()

    // Ensure there's at least one owned item to delete
    let countBefore = await feed.getMediaCount()
    const deleteButton = page.getByRole('button', { name: /Delete media/ }).first()
    const hasOwnedItem = await deleteButton.isVisible()
    if (!hasOwnedItem) {
      await feed.openUploadModal()
      await modal.selectTestImage()
      await modal.clickUpload()
      await modal.waitForCompletion()
      await page.reload()
      await feed.expectLoaded()
      countBefore = await feed.getMediaCount()
    }

    await deleteButton.click()

    const dialog = page.getByRole('dialog', { name: 'Delete media?' })
    await expect(dialog).toBeVisible()

    // Cancel
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible()

    // Count unchanged
    const countAfter = await feed.getMediaCount()
    expect(countAfter).toBe(countBefore)
  })
})
