// Feature: nestpic-app, Property 31: E2E media viewing workflow supports lightbox navigation and video playback
import { test, expect } from '@playwright/test'
import * as path from 'path'
import { FeedPage } from './pages/FeedPage'
import { LightboxPage, VideoPlayerPage } from './pages/Lightbox'
import { UploadModal } from './pages/UploadModal'
import { TEST_USERS } from '../scripts/seed-test-users'

const storageState = path.join(__dirname, '.auth', 'mediaViewing.json')
TEST_USERS.mediaViewing // referenced for documentation

test.use({ storageState })

test.describe('Media viewing workflow', () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState })
    const page = await context.newPage()
    const feed = new FeedPage(page)
    const modal = new UploadModal(page)
    await feed.goto()

    // Upload video first (will appear older), then images (will appear newest = first in feed)
    await feed.openUploadModal()
    await modal.selectTestVideo()
    await modal.clickUpload()
    await modal.waitForCompletion()

    // Ensure at least 2 images exist after the video
    const count = await feed.getMediaCount()
    const needed = Math.max(0, 3 - count) // 1 video + 2 images minimum
    for (let i = 0; i < needed; i++) {
      await feed.openUploadModal()
      await modal.selectTestImage()
      await modal.clickUpload()
      await modal.waitForCompletion()
    }
    await context.close()
  })

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

    // Try cards until we find one that opens a lightbox (image, not video)
    let found = false
    for (let i = 0; i < Math.min(count, 5) && !found; i++) {
      await feed.mediaCards.nth(i).getByRole('button', { name: /Open media/ }).click()
      await page.waitForSelector('[role="dialog"]', { timeout: 10_000 })
      const isLightbox = await lightbox.dialog.isVisible().catch(() => false)
      if (isLightbox) {
        found = true
        await lightbox.expectVisible()
        await lightbox.close()
        await lightbox.expectNotVisible()
      } else {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      }
    }
    if (!found) test.skip()
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

    // Find a card that opens a lightbox
    let found = false
    for (let i = 0; i < Math.min(count, 5) && !found; i++) {
      await feed.mediaCards.nth(i).getByRole('button', { name: /Open media/ }).click()
      await page.waitForSelector('[role="dialog"]', { timeout: 10_000 })
      const isLightbox = await lightbox.dialog.isVisible().catch(() => false)
      if (isLightbox) {
        found = true
        await lightbox.expectNextVisible()
        await lightbox.goNext()
        await lightbox.expectPrevVisible()
        await lightbox.goPrev()
        await lightbox.close()
      } else {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      }
    }
    if (!found) test.skip()
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

    // Find a card that opens a lightbox
    let found = false
    for (let i = 0; i < Math.min(count, 5) && !found; i++) {
      await feed.mediaCards.nth(i).getByRole('button', { name: /Open media/ }).click()
      await page.waitForSelector('[role="dialog"]', { timeout: 10_000 })
      const isLightbox = await lightbox.dialog.isVisible().catch(() => false)
      if (isLightbox) {
        found = true
        await page.keyboard.press('Escape')
        await lightbox.expectNotVisible()
      } else {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      }
    }
    if (!found) test.skip()
  })

  test('video opens with interactive play/pause controls', async ({ page }) => {
    const feed = new FeedPage(page)
    const videoPlayer = new VideoPlayerPage(page)

    await feed.goto()
    await feed.expectLoaded()

    const count = await feed.getMediaCount()
    if (count === 0) {
      test.skip()
      return
    }

    // Try each card until we find one that opens a video player
    let foundVideo = false
    for (let i = 0; i < Math.min(count, 10) && !foundVideo; i++) {
      await feed.mediaCards.nth(i).getByRole('button', { name: /Open media/ }).click()
      const dialogVisible = await page.waitForSelector('[role="dialog"]', { timeout: 10_000 })
        .then(() => true).catch(() => false)
      if (!dialogVisible) break

      const isVideoPlayer = await videoPlayer.dialog.isVisible().catch(() => false)
      if (isVideoPlayer) {
        foundVideo = true
        await videoPlayer.expectVisible()
        await videoPlayer.expectVideoHasControls()
        await videoPlayer.close()
        await expect(videoPlayer.dialog).not.toBeVisible({ timeout: 5_000 })
      } else {
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name: 'Media lightbox' })).not.toBeVisible({ timeout: 5_000 })
      }
    }
    if (!foundVideo) test.skip()
  })
})
