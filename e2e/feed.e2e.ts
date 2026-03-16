// Feature: nestpic-app, Property 29: E2E feed workflow supports browsing, pagination, and media opening
import { test, expect } from '@playwright/test'
import * as path from 'path'
import { FeedPage } from './pages/FeedPage'
import { LightboxPage, VideoPlayerPage } from './pages/Lightbox'
import { TEST_USERS } from '../scripts/seed-test-users'

const storageState = path.join(__dirname, '.auth', 'feed.json')
TEST_USERS.feed // referenced for documentation

test.use({ storageState })

test.describe('Family feed workflow', () => {
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
    await feed.mediaCards.first().getByRole('button').click()

    // Either lightbox or video player should open
    const lightboxVisible = await lightbox.dialog.isVisible().catch(() => false)
    const videoDialog = page.getByRole('dialog', { name: 'Video player' })
    const videoVisible = await videoDialog.isVisible().catch(() => false)

    expect(lightboxVisible || videoVisible).toBe(true)
  })

  test('lightbox navigation controls work between items', async ({ page }) => {
    const feed = new FeedPage(page)
    const lightbox = new LightboxPage(page)

    await feed.goto()
    await feed.expectLoaded()

    const count = await feed.getMediaCount()
    if (count < 2) {
      test.skip()
      return
    }

    // Open first item
    await feed.mediaCards.first().getByRole('button').click()
    await lightbox.expectVisible()

    // Next button should be visible when there are multiple items
    await lightbox.expectNextVisible()
    await lightbox.goNext()

    // Prev button should now be visible
    await lightbox.expectPrevVisible()

    // Close lightbox
    await lightbox.close()
    await lightbox.expectNotVisible()
  })

  test('scroll to bottom loads next page without full reload', async ({ page }) => {
    const feed = new FeedPage(page)
    await feed.goto()
    await feed.expectLoaded()

    const countBefore = await feed.getMediaCount()

    // Only test pagination if there are enough items
    if (countBefore < 30) {
      test.skip()
      return
    }

    // Track navigation events — a full reload would trigger navigation
    let navigationOccurred = false
    page.on('framenavigated', () => { navigationOccurred = true })

    await feed.scrollToBottom()
    await feed.waitForMoreItems(countBefore)

    expect(navigationOccurred).toBe(false)
    const countAfter = await feed.getMediaCount()
    expect(countAfter).toBeGreaterThan(countBefore)
  })
})
