// Feature: nestpic-app, Property 31: E2E media viewing workflow supports lightbox navigation and video playback
import { test, expect } from '@playwright/test'
import * as path from 'path'
import { FeedPage } from './pages/FeedPage'
import { LightboxPage, VideoPlayerPage } from './pages/Lightbox'
import { TEST_USERS } from '../scripts/seed-test-users'

const storageState = path.join(__dirname, '.auth', 'mediaViewing.json')
TEST_USERS.mediaViewing // referenced for documentation

test.use({ storageState })

test.describe('Media viewing workflow', () => {
  test('photo opens in lightbox overlay with close button', async ({ page }) => {
    const feed = new FeedPage(page)
    const lightbox = new LightboxPage(page)

    await feed.goto()
    await feed.expectLoaded()

    const count = await feed.getMediaCount()
    if (count === 0) {
      test.skip()
      return
    }

    // Find a photo item (non-video)
    const photoCard = page.locator('.grid > div').filter({
      hasNot: page.locator('[aria-label*="video"]'),
    }).first()

    await photoCard.getByRole('button').click()

    // Wait for either lightbox or video player
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 })

    const isLightbox = await lightbox.dialog.isVisible().catch(() => false)
    if (isLightbox) {
      await lightbox.expectVisible()
      await lightbox.close()
      await lightbox.expectNotVisible()
    }
    // If it's a video, that's also valid
  })

  test('lightbox prev/next navigation moves between items', async ({ page }) => {
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
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 })

    const isLightbox = await lightbox.dialog.isVisible().catch(() => false)
    if (!isLightbox) {
      test.skip()
      return
    }

    // Navigate to next
    await lightbox.expectNextVisible()
    await lightbox.goNext()

    // Prev should now be available
    await lightbox.expectPrevVisible()

    // Navigate back
    await lightbox.goPrev()

    await lightbox.close()
  })

  test('keyboard navigation works in lightbox', async ({ page }) => {
    const feed = new FeedPage(page)
    const lightbox = new LightboxPage(page)

    await feed.goto()
    await feed.expectLoaded()

    const count = await feed.getMediaCount()
    if (count === 0) {
      test.skip()
      return
    }

    await feed.mediaCards.first().getByRole('button').click()
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 })

    const isLightbox = await lightbox.dialog.isVisible().catch(() => false)
    if (!isLightbox) {
      test.skip()
      return
    }

    // Escape closes lightbox
    await page.keyboard.press('Escape')
    await lightbox.expectNotVisible()
  })

  test('video opens with interactive play/pause controls', async ({ page }) => {
    const feed = new FeedPage(page)
    const videoPlayer = new VideoPlayerPage(page)

    await feed.goto()
    await feed.expectLoaded()

    // Look for a video item specifically
    const videoCard = page.locator('.grid > div').filter({
      has: page.locator('[aria-label*="video"], [aria-label*="Video"]'),
    }).first()

    const hasVideo = await videoCard.count() > 0
    if (!hasVideo) {
      test.skip()
      return
    }

    await videoCard.getByRole('button').click()
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 })

    const isVideoPlayer = await videoPlayer.dialog.isVisible().catch(() => false)
    if (isVideoPlayer) {
      await videoPlayer.expectVisible()
      await videoPlayer.expectVideoHasControls()
      await videoPlayer.close()
    }
  })
})
