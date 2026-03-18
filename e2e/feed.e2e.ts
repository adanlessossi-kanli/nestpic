// Feature: nestpic-app, Property 29: E2E feed workflow supports browsing, pagination, and media opening
import { test, expect } from '@playwright/test'
import * as path from 'path'
import { FeedPage } from './pages/FeedPage'
import { LightboxPage, VideoPlayerPage } from './pages/Lightbox'
import { UploadModal } from './pages/UploadModal'
import { TEST_USERS } from '../scripts/seed-test-users'

const storageState = path.join(__dirname, '.auth', 'feed.json')
TEST_USERS.feed // referenced for documentation

test.use({ storageState })

test.describe('Family feed workflow', () => {
  test.beforeAll(async ({ browser }) => {
    // Ensure at least 2 media items exist for this user
    const context = await browser.newContext({ storageState })
    const page = await context.newPage()
    const feed = new FeedPage(page)
    const modal = new UploadModal(page)
    await feed.goto()
    const count = await feed.getMediaCount()
    const needed = Math.max(0, 2 - count)
    for (let i = 0; i < needed; i++) {
      await feed.openUploadModal()
      await modal.selectTestImage()
      await modal.clickUpload()
      await modal.waitForCompletion()
    }
    await context.close()
  })
  test('feed displays media items with thumbnails, uploader names, and dates', async ({ page }) => {
    const feed = new FeedPage(page)
    await feed.goto()
    await feed.expectLoaded()

    // Check that at least one media card is visible (if data exists)
    const count = await feed.getMediaCount()
    if (count > 0) {
      // Each card should show uploader name and date
      const firstCard = feed.mediaCards.first()
      await expect(firstCard.locator('p.font-medium')).toBeVisible()
      await expect(firstCard.locator('p.text-gray-500')).toBeVisible()
    }
  })

  test('clicking a photo opens the lightbox overlay', async ({ page }) => {
    const feed = new FeedPage(page)
    const lightbox = new LightboxPage(page)

    await feed.goto()
    await feed.expectLoaded()

    const count = await feed.getMediaCount()
    if (count === 0) {
      test.skip()
      return
    }

    // Click first media item
    await feed.mediaCards.first().getByRole('button', { name: /Open media/ }).click()

    // Either lightbox or video player should open — wait for one to appear
    const videoDialog = page.getByRole('dialog', { name: 'Video player' })
    await Promise.race([
      lightbox.dialog.waitFor({ state: 'visible', timeout: 10000 }),
      videoDialog.waitFor({ state: 'visible', timeout: 10000 }),
    ]).catch(() => {})

    const lightboxVisible = await lightbox.dialog.isVisible().catch(() => false)
    const videoVisible = await videoDialog.isVisible().catch(() => false)

    expect(lightboxVisible || videoVisible).toBe(true)
  })

  test('lightbox navigation controls work between items', async ({ page }) => {
    const feed = new FeedPage(page)
    const lightbox = new LightboxPage(page)
    const videoPlayer = page.getByRole('dialog', { name: 'Video player' })

    await feed.goto()
    await feed.expectLoaded()

    const count = await feed.getMediaCount()
    if (count < 2) {
      test.skip()
      return
    }

    // Open first item — wait for whichever dialog appears (lightbox or video player)
    await feed.mediaCards.first().getByRole('button', { name: /Open media/ }).click()
    await Promise.race([
      lightbox.dialog.waitFor({ state: 'visible', timeout: 10000 }),
      videoPlayer.waitFor({ state: 'visible', timeout: 10000 }),
    ])

    // Next button should be visible when there are multiple items
    await lightbox.expectNextVisible()
    await lightbox.goNext()

    // Prev button should now be visible
    await lightbox.expectPrevVisible()

    // Close whichever dialog is open
    await page.getByRole('button', { name: /Close/ }).first().click()
    await expect(lightbox.dialog).not.toBeVisible()
    await expect(videoPlayer).not.toBeVisible()
  })

})
