// Feature: upload-labels-categories, E2E: category browsing
import { test, expect } from '@playwright/test'
import * as path from 'path'
import { FeedPage } from './pages/FeedPage'
import { UploadModal } from './pages/UploadModal'

const storageState = path.join(__dirname, '.auth', 'upload.json')

const uploadedMediaIds: string[] = []

test.use({ storageState })

test.describe('Category browsing', () => {
  test('uploaded media appears in the category view', async ({ page, request }) => {
    const feed = new FeedPage(page)
    const modal = new UploadModal(page)

    const testCategory = `e2e-cat-browse-${Date.now()}`
    const testLabel = 'category browse test'

    // Upload media with a category
    await feed.goto()
    await feed.expectLoaded()
    await feed.openUploadModal()
    await modal.expectVisible()
    await modal.selectTestImage()
    await modal.fillLabel(testLabel)
    await modal.createNewCategory(testCategory)

    let uploadedMediaId: string | undefined
    page.on('response', async (response) => {
      if (response.url().includes('/api/upload/confirm') && response.status() === 200) {
        const json = await response.json().catch(() => null)
        if (json?.media?.id) {
          uploadedMediaId = json.media.id
          uploadedMediaIds.push(json.media.id)
        }
      }
    })

    await modal.clickUpload()
    await modal.waitForProgress()
    await modal.waitForCompletion()

    // Wait for the confirm response to be captured
    await expect.poll(() => uploadedMediaId, { timeout: 10_000 }).toBeDefined()

    // GET /api/categories and find the created category
    const categoriesRes = await request.get('/api/categories')
    expect(categoriesRes.status()).toBe(200)
    const categories: Array<{ id: string; name: string }> = await categoriesRes.json()
    const created = categories.find((c) => c.name === testCategory)
    expect(created, `Category "${testCategory}" should exist`).toBeDefined()

    // GET /api/categories/[id]/media and assert the uploaded media appears
    const mediaRes = await request.get(`/api/categories/${created!.id}/media`)
    expect(mediaRes.status()).toBe(200)
    const body: { items: Array<{ id: string; label: string | null; category: string | null }> } =
      await mediaRes.json()

    const found = body.items.find((item) => item.id === uploadedMediaId)
    expect(found, 'Uploaded media should appear in the category view').toBeDefined()
    expect(found!.label).toBe(testLabel)
    expect(found!.category).toBe(testCategory)
  })
})

test.afterAll(async ({ request }) => {
  for (const id of uploadedMediaIds) {
    await request.delete(`/api/media/${id}`).catch(() => {})
  }
})
