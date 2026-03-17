# Implementation Plan: Upload Labels & Categories

## Overview

Extend the upload flow to support per-media labels and category groupings. The work proceeds in layers: DB migration → schema/type updates → API changes → UI changes → tests.

## Tasks

- [x] 1. Add database migration for labels and categories
  - Create `migrations/003_labels_categories.sql` with the `categories` table, `label` and `category_id` columns on `media`, unique constraint on `(name, created_by)`, and all required indexes
  - The migration is auto-discovered by `src/lib/migrations.ts` at boot — no extra wiring needed
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 2. Update TypeScript types and upload schemas
  - [x] 2.1 Update `FeedItem` in `src/lib/types/media.ts` to add `label: string | null` and `category: string | null`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 2.2 Update `src/lib/schemas/upload.ts`: add optional `label` (string ≤ 100) and `category` (string ≤ 100) to both `presignSchema` and `confirmSchema`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 2.3 Write property tests for schema validation (Properties 1 and 2)
    - **Property 1: Field length validation** — generate label/category strings of length 101–200, call presign route, assert 400
    - **Property 2: Presign accepts valid label and category** — generate strings of length 0–100, call presign route, assert 200
    - **Validates: Requirements 1.3, 2.3, 6.3, 6.4, 1.4, 2.5**
    - Place in `src/__tests__/property/upload-labels-categories.property.ts`

- [x] 3. Extend presign route to accept and persist label
  - Modify `src/app/api/upload/presign/route.ts` to read `label` and `category` from the validated body and store `label` in the `INSERT INTO media` statement
  - Category is not resolved at presign time — only `label` is stored now
  - _Requirements: 1.4, 6.1, 6.2_

- [x] 4. Extend confirm route to resolve category and activate media
  - Modify `src/app/api/upload/confirm/route.ts`:
    - Accept `category` from the request body (via updated `confirmSchema`)
    - If `category` is provided: `INSERT INTO categories (name, created_by) ON CONFLICT (name, created_by) DO NOTHING`, then `SELECT id FROM categories WHERE name=$1 AND created_by=$2`
    - `UPDATE media SET status='active', category_id=$categoryId WHERE id=$mediaId`
    - Return full media object including `label` and `category` name in the response
  - _Requirements: 2.6, 2.7, 2.10, 1.5_
  - [x] 4.1 Write property test for label round-trip (Property 3)
    - **Property 3: Label round-trip** — generate valid label (0–100 chars), presign + confirm, assert stored label equals input
    - **Validates: Requirements 1.5, 7.7**
    - Place in `src/__tests__/property/upload-labels-categories.property.ts`
  - [x] 4.2 Write property test for category creation idempotency (Property 4)
    - **Property 4: Category creation idempotency** — same category name, two confirms for same uploader, assert one DB row
    - **Validates: Requirements 2.10, 7.3**
    - Place in `src/__tests__/property/upload-labels-categories.property.ts`
  - [x] 4.3 Write property test for confirm linking media to category (Property 5)
    - **Property 5: Confirm links media to category** — confirm with category, assert `media.category_id` = resolved category id and `category.created_by` = uploader id
    - **Validates: Requirements 2.6, 2.7**
    - Place in `src/__tests__/property/upload-labels-categories.property.ts`

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement categories API routes
  - [x] 6.1 Create `src/app/api/categories/route.ts` — `GET /api/categories` returns all categories for the authenticated user, ordered by `created_at DESC`
    - _Requirements: 3.1_
  - [x] 6.2 Create `src/app/api/categories/[id]/media/route.ts` — `GET /api/categories/[id]/media` returns paginated media (≤ 30, cursor-based, `uploaded_at DESC`) for a category, including `label`, `category`, `thumbnailUrl`, `uploaderName`, `uploadedAt`
    - Return 401 for unauthenticated requests; 404 if category ID not found
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  - [x] 6.3 Write property test for category view ordering (Property 6)
    - **Property 6: Category view ordering invariant** — generate N media with random timestamps, assert response is sorted by `uploaded_at` DESC
    - **Validates: Requirements 3.3, 7.4**
    - Place in `src/__tests__/property/upload-labels-categories.property.ts`
  - [x] 6.4 Write property test for category view pagination (Property 7)
    - **Property 7: Category view pagination** — generate > 30 media rows, assert page ≤ 30 and `nextCursor` is non-null
    - **Validates: Requirements 3.4**
    - Place in `src/__tests__/property/upload-labels-categories.property.ts`
  - [x] 6.5 Write property test for response shape (Property 8)
    - **Property 8: Response shape includes label and category** — generate media with/without label and category, assert both fields present in response
    - **Validates: Requirements 3.5, 4.1, 4.2, 4.3, 4.4**
    - Place in `src/__tests__/property/upload-labels-categories.property.ts`
  - [x] 6.6 Write property test for 404 on unknown category (Property 9)
    - **Property 9: Category view 404 for unknown ID** — generate random UUID not in DB, assert 404
    - **Validates: Requirements 3.7**
    - Place in `src/__tests__/property/upload-labels-categories.property.ts`

- [x] 7. Update feed and album routes to include label and category
  - Modify `src/app/api/feed/route.ts`: update SQL to `JOIN categories c ON c.id = m.category_id` (LEFT JOIN), select `m.label` and `c.name AS category_name`, include both in the returned `FeedItem`
  - Modify `src/app/api/albums/[id]/media/route.ts` (GET handler): apply the same JOIN and field additions
  - Update the local `FeedItem` interface in `src/app/api/feed/route.ts` to match the updated type
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 8. Update UploadForm component
  - Modify `src/components/UploadForm.tsx`:
    - Add `<input type="text" maxLength={100}>` for label with client-side validation (> 100 chars → error)
    - Fetch `GET /api/categories` on mount and populate a `<select>` with existing categories plus a "New category…" option
    - When "New category…" is selected, reveal a text input for the new category name with client-side validation (> 100 chars → error)
    - Pass `label` and `category` in the presign request body
    - Update the `onSuccess` callback to pass the full `FeedItem` including `label` and `category`
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4_

- [x] 9. Update E2E page object and tests
  - [x] 9.1 Update `e2e/pages/UploadModal.ts` to add helper methods for filling in label and selecting/creating a category
    - _Requirements: 7.5_
  - [x] 9.2 Update `e2e/upload.e2e.ts` to fill in a label and select/create a category before clicking Upload, and assert the confirmed media response includes the submitted label and category
    - _Requirements: 7.5_
  - [x] 9.3 Add category browsing E2E test in `e2e/categories.e2e.ts`
    - Upload media with a category, call `GET /api/categories` to find the created category, call `GET /api/categories/[id]/media` and assert the uploaded media appears there
    - _Requirements: 7.6_

- [x] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check with a minimum of 100 iterations per property
- The migration file is auto-applied at boot — no manual wiring needed
