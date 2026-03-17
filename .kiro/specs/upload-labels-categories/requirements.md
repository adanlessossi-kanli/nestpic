# Requirements Document

## Introduction

This feature adds label and category metadata to uploaded photos and videos in NestPic. Users can assign a free-text label and select or create a category at upload time. Media is then organized and browsed by category, with items within each category sorted in reverse chronological order. The existing upload flow (presign → upload → confirm) is extended to carry this metadata, and all related tests are updated accordingly.

## Glossary

- **System**: The NestPic web application (Next.js + TypeScript).
- **Media**: A photo or video file uploaded by a user.
- **Label**: A short, user-defined text string attached to a single Media item to describe its content (e.g. "Beach sunset").
- **Category**: A user-defined grouping name that organises multiple Media items (e.g. "Holidays", "Family").
- **Upload_Flow**: The three-step sequence: presign → object-store upload → confirm.
- **Category_View**: The UI page or API endpoint that lists Media items belonging to a single Category.
- **Uploader**: The authenticated user who initiates an upload.
- **Presign_API**: The `POST /api/upload/presign` endpoint.
- **Confirm_API**: The `POST /api/upload/confirm` endpoint.
- **Feed**: The existing reverse-chronological media listing across all categories.

---

## Requirements

### Requirement 1: Label assignment during upload

**User Story:** As an Uploader, I want to attach a label to each photo or video I upload, so that I can identify and describe individual media items.

#### Acceptance Criteria

1. THE Upload_Form SHALL display a text input field for the label before the upload is submitted.
2. WHEN an Uploader submits an upload without entering a label, THE Upload_Form SHALL accept the submission and treat the label as an empty string.
3. WHEN an Uploader enters a label longer than 100 characters, THE Upload_Form SHALL display a validation error and prevent submission.
4. WHEN a valid label is provided, THE Presign_API SHALL accept the label as part of the request body.
5. WHEN a valid label is provided, THE Confirm_API SHALL persist the label value to the media record in the database.
6. THE System SHALL store the label as a nullable VARCHAR(100) column on the `media` table.

---

### Requirement 2: Category assignment during upload

**User Story:** As an Uploader, I want to assign a category to each photo or video I upload, so that my media is organised into meaningful groups.

#### Acceptance Criteria

1. THE Upload_Form SHALL display a category selector that lists all existing categories created by the Uploader.
2. THE Upload_Form SHALL provide an option to create a new category by entering a name.
3. WHEN an Uploader enters a new category name longer than 100 characters, THE Upload_Form SHALL display a validation error and prevent submission.
4. WHEN an Uploader submits an upload without selecting or creating a category, THE Upload_Form SHALL accept the submission and leave the media uncategorised.
5. WHEN a category is selected or created, THE Presign_API SHALL accept the category name as part of the request body.
6. WHEN a new category name is provided at upload time, THE Confirm_API SHALL create the category record if it does not already exist for that Uploader.
7. WHEN a category is resolved, THE Confirm_API SHALL associate the media record with that category.
8. THE System SHALL store categories in a dedicated `categories` table with columns: `id`, `name`, `created_by`, `created_at`.
9. THE System SHALL store the media-to-category association via a `category_id` foreign key column on the `media` table.
10. WHEN two uploads by the same Uploader use the same category name, THE Confirm_API SHALL reuse the existing category record rather than creating a duplicate.

---

### Requirement 3: Category browsing

**User Story:** As a user, I want to browse media organised by category, so that I can find related photos and videos quickly.

#### Acceptance Criteria

1. THE System SHALL expose a `GET /api/categories` endpoint that returns all categories visible to the authenticated user.
2. WHEN a valid category ID is provided, THE System SHALL expose a `GET /api/categories/[id]/media` endpoint that returns the Media items in that category.
3. WHILE returning Media items for a category, THE System SHALL order them by `uploaded_at` descending (newest first).
4. WHEN a category contains more than 30 Media items, THE System SHALL return results in pages of at most 30 items and include a cursor for the next page.
5. THE System SHALL include `label`, `category`, `thumbnailUrl`, `uploaderName`, and `uploadedAt` fields in each Media item returned by the Category_View.
6. IF a request to `GET /api/categories/[id]/media` is made by an unauthenticated user, THEN THE System SHALL return a 401 Unauthorized response.
7. IF a request is made for a category ID that does not exist, THEN THE System SHALL return a 404 Not Found response.

---

### Requirement 4: Label and category in existing views

**User Story:** As a user, I want to see the label and category of media items in the feed and album views, so that I have full context when browsing.

#### Acceptance Criteria

1. WHEN the Feed returns Media items, THE System SHALL include the `label` and `category` fields alongside existing fields.
2. WHEN an Album view returns Media items, THE System SHALL include the `label` and `category` fields alongside existing fields.
3. WHEN a Media item has no label, THE System SHALL return `null` for the `label` field.
4. WHEN a Media item has no category, THE System SHALL return `null` for the `category` field.

---

### Requirement 5: Data integrity and migration

**User Story:** As a developer, I want the database schema to be updated via a migration, so that the changes are applied consistently across all environments.

#### Acceptance Criteria

1. THE System SHALL provide a new SQL migration file that adds the `categories` table and the `label` and `category_id` columns to the `media` table.
2. THE System SHALL add a unique constraint on `(name, created_by)` in the `categories` table to prevent duplicate category names per user.
3. THE System SHALL add a database index on `media(category_id)` to support efficient category queries.
4. THE System SHALL add a database index on `media(category_id, uploaded_at DESC)` to support efficient sorted category browsing.
5. WHEN the migration is applied to an existing database, THE System SHALL leave all existing media records with `label = NULL` and `category_id = NULL`.

---

### Requirement 6: Input validation schemas

**User Story:** As a developer, I want the upload schemas to be updated to include label and category fields, so that API inputs are validated consistently.

#### Acceptance Criteria

1. THE System SHALL update `presignSchema` to include an optional `label` field (string, max 100 characters).
2. THE System SHALL update `presignSchema` to include an optional `category` field (string, max 100 characters).
3. WHEN `label` exceeds 100 characters, THE Presign_API SHALL return a 400 validation error.
4. WHEN `category` exceeds 100 characters, THE Presign_API SHALL return a 400 validation error.
5. THE System SHALL update `confirmSchema` to accept an optional `label` field and an optional `category` field, mirroring the presign schema.

---

### Requirement 7: Updated tests

**User Story:** As a developer, I want all existing and new tests to reflect the label and category changes, so that regressions are caught automatically.

#### Acceptance Criteria

1. THE System SHALL update the upload property tests to assert that `label` and `category` are persisted when provided.
2. THE System SHALL add property tests that verify a Media item with any label value up to 100 characters is accepted and stored correctly.
3. THE System SHALL add property tests that verify category creation is idempotent: uploading the same category name twice results in exactly one category record.
4. THE System SHALL add property tests that verify Category_View results are always ordered by `uploaded_at` descending.
5. THE System SHALL update the upload E2E test to fill in a label and category before submitting.
6. THE System SHALL add an E2E test that navigates to a category view and verifies the uploaded media appears there.
7. FOR ALL valid label strings of length 0–100, THE System SHALL accept the upload without a validation error (round-trip property: label stored equals label submitted).
