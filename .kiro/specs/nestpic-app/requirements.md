# Requirements Document

## Introduction

Nestpic is a family-focused photo and video sharing platform built with Next.js and deployed on AWS. It allows family members to upload, browse, and share media in a private, invite-only environment. The app provides organized albums, a shared family feed, and basic media management — all scoped to a closed family group.

Media files and thumbnails are stored in Amazon S3. Metadata is persisted in Amazon RDS (PostgreSQL). Media is delivered to clients via Amazon CloudFront. Uploads use S3 presigned URLs to avoid routing large files through the application server. All AWS resources follow least-privilege IAM policies.

## Glossary

- **System**: The Nestpic Next.js web application
- **User**: An authenticated family member with access to the platform
- **Guest**: An unauthenticated visitor attempting to access the platform
- **Media**: A photo or video file uploaded by a User
- **Album**: A named collection of Media items created by a User
- **Feed**: The chronological stream of recently uploaded Media visible to all Users
- **Uploader**: The subsystem responsible for generating presigned upload URLs and confirming completed uploads
- **Auth_Service**: The subsystem responsible for authentication and session management
- **Media_Store**: The subsystem responsible for persisting and retrieving Media metadata in RDS and files in S3
- **Thumbnail_Generator**: The subsystem responsible for generating preview images from Media, triggered via S3 event notifications
- **S3_Bucket**: The Amazon S3 bucket used to store original Media files and generated thumbnails
- **CDN**: The Amazon CloudFront distribution used to serve Media files and thumbnails to clients
- **Database**: The Amazon RDS PostgreSQL instance used to store all application metadata
- **Local_Dev_Environment**: The local development setup using OpenStack to simulate AWS infrastructure without requiring real AWS credentials
- **Object_Store**: The storage abstraction layer used by the application to interact with either S3_Bucket in production or OpenStack_Swift locally
- **OpenStack_Swift**: The OpenStack object storage service used locally as an S3-compatible drop-in replacement for S3_Bucket during development
- **Storage_Config**: The environment-driven configuration that determines whether the application connects to OpenStack_Swift or S3_Bucket
- **E2E_Test_Suite**: The Playwright-based end-to-end test suite that exercises key user workflows through a real browser against a running application instance
- **Test_User**: A seeded user account used exclusively by the E2E_Test_Suite during test execution
- **Page_Object**: A class encapsulating Playwright selectors and interactions for a specific page or component, used to keep E2E test code maintainable
- **Rate_Limiter**: The subsystem responsible for tracking and enforcing request rate limits on sensitive endpoints
- **Schema_Validator**: The Zod-based runtime validation layer applied to all API route inputs
- **Secrets_Manager**: AWS Secrets Manager (or SSM Parameter Store) used to store and retrieve production secrets at runtime

---

## Requirements

### Requirement 1: User Authentication

**User Story:** As a family member, I want to sign in with my account, so that only authorized family members can access shared media.

#### Acceptance Criteria

1. WHEN a Guest navigates to any protected route, THE System SHALL redirect the Guest to the sign-in page.
2. WHEN a User submits valid credentials, THE Auth_Service SHALL create an authenticated session and redirect the User to the Feed.
3. IF a User submits invalid credentials, THEN THE Auth_Service SHALL display an error message and SHALL NOT create a session.
4. WHEN an authenticated User requests to sign out, THE Auth_Service SHALL invalidate the session and redirect the User to the sign-in page.
5. WHILE a User session is active, THE Auth_Service SHALL maintain the session for at least 7 days without requiring re-authentication.
6. THE Auth_Service SHALL store session tokens server-side and SHALL NOT expose AWS credentials or IAM role details to the client.
7. WHEN a User successfully signs in, THE Auth_Service SHALL issue a new session ID (session rotation) to prevent session fixation attacks.
8. THE Auth_Service SHALL enforce rate limiting on the sign-in endpoint, rejecting more than 10 requests per IP per minute with HTTP 429.
9. THE Auth_Service SHALL enforce rate limiting on the invitation generation endpoint, rejecting more than 5 requests per authenticated User per hour with HTTP 429.

---

### Requirement 2: Media Upload

**User Story:** As a family member, I want to upload photos and videos, so that I can share memories with the rest of the family.

#### Acceptance Criteria

1. WHEN a User selects one or more files for upload, THE Uploader SHALL accept JPEG, PNG, GIF, WebP, MP4, MOV, and AVI file formats.
2. IF a User selects a file exceeding 200 MB, THEN THE Uploader SHALL reject the file and display a size limit error to the User.
3. IF a User selects a file of an unsupported format, THEN THE Uploader SHALL reject the file and display a format error to the User.
4. WHEN a User initiates an upload, THE Uploader SHALL request a presigned S3 PUT URL from the server and SHALL upload the file directly from the client to S3_Bucket using that URL.
5. WHEN a User uploads a Media file, THE Uploader SHALL display upload progress as a percentage to the User.
6. WHEN a presigned S3 PUT URL is generated, THE Uploader SHALL set the URL expiry to no more than 15 minutes.
7. WHEN a Media file upload to S3_Bucket completes, THE Uploader SHALL notify the server, and THE Media_Store SHALL persist the Media metadata — including the S3 object key, content type, file size, and uploading User identity — to the Database.
8. WHEN a photo is uploaded, THE Thumbnail_Generator SHALL generate a preview thumbnail within 30 seconds of the S3 upload event.
9. WHEN a video is uploaded, THE Thumbnail_Generator SHALL generate a preview thumbnail from the first frame within 60 seconds of the S3 upload event.
10. WHEN a thumbnail is generated, THE Thumbnail_Generator SHALL store the thumbnail in S3_Bucket under a dedicated thumbnails prefix and SHALL record the thumbnail S3 object key in the Database.
11. THE S3_Bucket SHALL be configured with Block Public Access enabled, and all client access to Media files SHALL be served exclusively through CDN using signed or presigned URLs.
12. WHEN a presigned S3 PUT URL is generated, THE Uploader SHALL constrain the URL with the expected Content-Type and a maximum Content-Length matching the declared file size to prevent content-type spoofing.
13. THE System SHALL run a scheduled cleanup job that deletes Media records with status `pending` and their associated S3 objects when the record is older than 1 hour.

---

### Requirement 3: Family Feed

**User Story:** As a family member, I want to see a shared feed of recently uploaded media, so that I can stay up to date with what the family is sharing.

#### Acceptance Criteria

1. WHEN an authenticated User navigates to the Feed, THE System SHALL display Media items in reverse chronological order by upload date.
2. THE System SHALL display each Media item in the Feed with its thumbnail, uploader name, and upload date.
3. WHEN serving thumbnails in the Feed, THE System SHALL deliver thumbnail images via CDN using short-lived signed URLs valid for no more than 1 hour.
4. WHEN the Feed contains more than 30 Media items, THE System SHALL paginate results in sets of 30 items.
5. WHEN a User scrolls to the bottom of a Feed page, THE System SHALL load the next page of Media items without a full page reload.
6. WHILE the Feed is loading, THE System SHALL display a loading indicator to the User.

---

### Requirement 4: Album Management

**User Story:** As a family member, I want to organize media into albums, so that related photos and videos are easy to find.

#### Acceptance Criteria

1. WHEN a User creates an album, THE Media_Store SHALL persist the album with a name, creation date, and the creating User's identity to the Database.
2. IF a User submits an album name that is empty or exceeds 100 characters, THEN THE System SHALL reject the request and display a validation error.
3. WHEN a User adds a Media item to an album, THE Media_Store SHALL persist the association between the Media item and the album in the Database.
4. THE Media_Store SHALL allow a single Media item to belong to multiple albums simultaneously.
5. WHEN a User views an album, THE System SHALL display all Media items in that album in reverse chronological order by upload date.
6. WHEN a User deletes an album, THE Media_Store SHALL remove the album record from the Database and SHALL preserve all Media items and their S3 objects that belonged to it.

---

### Requirement 5: Media Viewing

**User Story:** As a family member, I want to view photos and videos in full resolution, so that I can enjoy the media in detail.

#### Acceptance Criteria

1. WHEN a User selects a photo from the Feed or an album, THE System SHALL display the photo at full resolution in a lightbox overlay, served via CDN using a short-lived signed URL valid for no more than 1 hour.
2. WHEN a User selects a video from the Feed or an album, THE System SHALL display an inline video player with play, pause, and seek controls, with the video stream served via CDN.
3. WHEN a User is viewing a Media item in the lightbox, THE System SHALL provide navigation controls to move to the previous and next Media item in the current context.
4. WHEN a User closes the lightbox, THE System SHALL return the User to the Feed or album view without a full page reload.

---

### Requirement 6: Media Deletion

**User Story:** As a family member, I want to delete media I uploaded, so that I can remove content I no longer want to share.

#### Acceptance Criteria

1. WHEN a User requests to delete a Media item, THE System SHALL display a confirmation prompt before proceeding.
2. WHEN a User confirms deletion of a Media item they uploaded, THE Media_Store SHALL delete the original file and all associated thumbnails from S3_Bucket and SHALL remove all corresponding records from the Database.
3. IF a User attempts to delete a Media item uploaded by another User, THEN THE System SHALL reject the request and display a permission error.
4. WHEN a Media item is deleted, THE System SHALL remove it from all album associations and from the Feed.

---

### Requirement 7: Family Member Invitation

**User Story:** As a family member, I want to invite other family members to join, so that the platform remains private and limited to our family.

#### Acceptance Criteria

1. WHEN an authenticated User generates an invitation, THE Auth_Service SHALL create a unique, single-use invitation token, persist it to the Database, and return an invitation link valid for 72 hours.
2. WHEN a Guest follows a valid invitation link, THE System SHALL present a registration form to the Guest.
3. WHEN a Guest submits a valid registration form via an invitation link, THE Auth_Service SHALL create a new User account in the Database and invalidate the invitation token.
4. IF a Guest follows an expired or already-used invitation link, THEN THE System SHALL display an error message and SHALL NOT present a registration form.
5. THE Auth_Service SHALL enforce a minimum password length of 8 characters during registration.
6. THE Auth_Service SHALL store passwords as salted hashes in the Database and SHALL NOT store plaintext passwords.
7. THE Auth_Service SHALL use a bcrypt cost factor of at least 12 when hashing passwords.
8. WHEN validating an invitation token, THE Auth_Service SHALL use a constant-time comparison to prevent timing attacks.
9. THE Auth_Service SHALL enforce rate limiting on the registration endpoint, rejecting more than 5 registration attempts per IP per hour with HTTP 429.

---

### Requirement 8: Responsive Layout

**User Story:** As a family member, I want to use Nestpic on any device, so that I can view and upload media from my phone, tablet, or desktop.

#### Acceptance Criteria

1. THE System SHALL render a functional layout on viewport widths from 320px to 2560px.
2. WHEN the viewport width is less than 768px, THE System SHALL display a single-column media grid.
3. WHEN the viewport width is between 768px and 1279px, THE System SHALL display a two-column media grid.
4. WHEN the viewport width is 1280px or greater, THE System SHALL display a media grid with at least three columns.

---

### Requirement 9: AWS Infrastructure and Data Storage

**User Story:** As a system operator, I want the application to follow AWS best practices, so that media is stored durably, delivered efficiently, and accessed securely.

#### Acceptance Criteria

1. THE Media_Store SHALL store all Media files and thumbnails in S3_Bucket with server-side encryption (SSE-S3 or SSE-KMS) enabled.
2. THE Media_Store SHALL store all application metadata — including User records, Media records, Album records, and invitation tokens — in the Database using Amazon RDS PostgreSQL.
3. THE S3_Bucket SHALL have versioning enabled to protect against accidental deletion of Media files.
4. THE CDN SHALL be configured as the sole public-facing origin for S3_Bucket, and direct S3 access SHALL be restricted to the CDN origin identity and authorized IAM roles only.
5. THE System SHALL use IAM roles with least-privilege policies for all AWS service interactions, and SHALL NOT use long-lived IAM access keys in application code.
6. WHEN the application generates a presigned S3 URL or a CDN signed URL, THE System SHALL scope the URL to the specific S3 object key being accessed.
7. THE Database SHALL be deployed in a private VPC subnet with no public internet access, and SHALL only accept connections from the application's compute layer.
8. THE S3_Bucket SHALL be configured with a lifecycle policy that transitions Media files older than 365 days to S3 Intelligent-Tiering to optimize storage costs.
9. THE Database connection layer SHALL use connection pooling (RDS Proxy or PgBouncer) to handle connection spikes from Lambda cold starts and serverless compute.
10. THE S3_Bucket SHALL have MFA Delete enabled on versioned objects to provide an additional layer of protection against accidental or malicious deletion.
11. THE CDN SHALL have an AWS WAF Web ACL attached to protect against common web exploits and DDoS attacks.
12. THE Database SHALL have automated backups enabled with a retention period of at least 7 days.
13. THE System SHALL retrieve all production secrets (database credentials, session secret, CDN private key) from AWS Secrets Manager or SSM Parameter Store at runtime, and SHALL NOT store secrets in environment variable files committed to source control.
14. THE Thumbnail_Generator Lambda SHALL be configured with a Dead Letter Queue (DLQ) so that failed thumbnail generation events are captured for inspection and retry.
15. THE System SHALL have CloudWatch alarms configured for Lambda error rate and RDS connection count, alerting when thresholds are exceeded.

---

### Requirement 10: Local Development Environment

**User Story:** As a developer, I want to run the full application stack locally using OpenStack to simulate AWS infrastructure, so that I can develop and test without needing real AWS credentials or incurring cloud costs.

#### Acceptance Criteria

1. THE Local_Dev_Environment SHALL provide an OpenStack_Swift instance configured as an S3-compatible endpoint that the application can use in place of S3_Bucket during local development.
2. WHEN the application is started with a `NODE_ENV=development` environment variable, THE Storage_Config SHALL configure the Object_Store to connect to the OpenStack_Swift endpoint instead of S3_Bucket.
3. WHEN the application is started with a `NODE_ENV=production` environment variable, THE Storage_Config SHALL configure the Object_Store to connect to the real S3_Bucket endpoint using IAM role credentials.
4. THE Object_Store SHALL expose a consistent interface for presigned URL generation, file upload, file retrieval, and file deletion regardless of whether the underlying provider is OpenStack_Swift or S3_Bucket.
5. THE Local_Dev_Environment SHALL NOT require real AWS credentials, IAM roles, or active AWS account access to run the application locally.
6. WHEN a developer runs the local stack, THE Local_Dev_Environment SHALL provide a locally accessible OpenStack_Swift endpoint that accepts the same S3 API operations used by the application in production.
7. THE Storage_Config SHALL read the object store endpoint URL, access key, and secret key from environment variables so that no provider-specific values are hardcoded in application code.
8. IF the required object store environment variables are missing at startup, THEN THE System SHALL log a descriptive configuration error and SHALL NOT start the application.
9. THE Local_Dev_Environment SHALL provide a `docker-compose.yml` that starts all required services — PostgreSQL, OpenStack Swift, and an optional local thumbnail worker — with a single `docker compose up` command.
10. THE Local_Dev_Environment SHALL expose health check endpoints for each Docker Compose service so that dependent services wait until dependencies are ready before starting.
11. THE System SHALL provide a `.env.example` file committed to the repository containing all required environment variable names with placeholder values and no real secrets.
12. THE System SHALL provide a `Makefile` or `package.json` scripts covering common developer tasks: `dev`, `db:migrate`, `db:seed`, `test`, and `test:e2e`.

---

### Requirement 11: End-to-End Testing with Playwright

**User Story:** As a developer, I want automated end-to-end tests covering key user workflows, so that regressions in critical paths are caught before deployment.

#### Acceptance Criteria

1. THE E2E_Test_Suite SHALL use Playwright as the browser automation framework and SHALL run against a locally running instance of the System backed by the Local_Dev_Environment.

2. WHEN the E2E_Test_Suite executes the authentication workflow, THE E2E_Test_Suite SHALL verify that:
   - A Test_User can sign in with valid credentials and be redirected to the Feed
   - A Test_User can sign out and be redirected to the sign-in page
   - A Guest navigating to a protected route is redirected to the sign-in page

3. WHEN the E2E_Test_Suite executes the media upload workflow, THE E2E_Test_Suite SHALL verify that:
   - A Test_User can select a supported file and initiate an upload
   - Upload progress is displayed to the Test_User during the upload
   - The uploaded Media item appears in the Feed after the upload completes

4. WHEN the E2E_Test_Suite executes the family feed workflow, THE E2E_Test_Suite SHALL verify that:
   - A Test_User can browse the Feed and see Media items with thumbnails, uploader names, and upload dates
   - Scrolling to the bottom of the Feed triggers loading of the next page of Media items without a full page reload
   - A Test_User can open a Media item from the Feed into the lightbox or video player

5. WHEN the E2E_Test_Suite executes the album management workflow, THE E2E_Test_Suite SHALL verify that:
   - A Test_User can create a new album with a valid name and see it appear in the albums list
   - A Test_User can add a Media item to an album and see it appear in the album view
   - A Test_User can view an album and see its Media items in reverse chronological order
   - A Test_User can delete an album and confirm it no longer appears in the albums list

6. WHEN the E2E_Test_Suite executes the media viewing workflow, THE E2E_Test_Suite SHALL verify that:
   - A Test_User can open a photo from the Feed and view it in the lightbox overlay
   - A Test_User can navigate to the previous and next Media item using lightbox navigation controls
   - A Test_User can open a video from the Feed and interact with the video player play and pause controls

7. WHEN the E2E_Test_Suite executes the media deletion workflow, THE E2E_Test_Suite SHALL verify that:
   - A Test_User can delete a Media item they uploaded after confirming the deletion prompt
   - The deleted Media item no longer appears in the Feed after deletion

8. WHEN the E2E_Test_Suite executes the invitation workflow, THE E2E_Test_Suite SHALL verify that:
   - An authenticated Test_User can generate an invitation link
   - A Guest can follow the invitation link and successfully register a new account

9. IF an E2E test step fails, THEN THE E2E_Test_Suite SHALL capture a screenshot and a Playwright trace at the point of failure to aid debugging.

10. THE E2E_Test_Suite SHALL be executable with a single command and SHALL exit with a non-zero code if any test fails.

11. THE E2E_Test_Suite SHALL implement the Page Object Model (POM) pattern, encapsulating all page selectors and interactions in dedicated Page_Object classes to keep test code maintainable and DRY.

12. THE E2E_Test_Suite SHALL use `test.use({ storageState })` to reuse authenticated browser state across tests within a file, avoiding redundant sign-in steps in every test case.

13. WHEN running in CI, THE E2E_Test_Suite SHALL use the `--reporter=html` flag to produce a human-readable HTML report of test results.

14. EACH E2E test file SHALL clean up any data it creates (or use an isolated Test_User per file) to ensure test isolation and prevent cross-test contamination.

15. THE Local_Dev_Environment SHALL provide a `docker-compose.test.yml` that spins up an isolated PostgreSQL instance and OpenStack Swift instance exclusively for the E2E_Test_Suite, separate from the development stack.

---

### Requirement 12: Security Headers and Input Validation

**User Story:** As a system operator, I want the application to enforce HTTP security headers and validate all API inputs, so that common web vulnerabilities are mitigated at the framework level.

#### Acceptance Criteria

1. THE System SHALL apply HTTP security headers on all responses via Next.js middleware, including: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, and `X-Content-Type-Options: nosniff`.
2. THE System SHALL apply CSRF protection on all state-mutating API routes (POST, PUT, PATCH, DELETE) to prevent cross-site request forgery.
3. ALL API route handlers SHALL validate their request inputs using Zod schemas before processing, and SHALL return HTTP 400 with a structured validation error if the input does not conform to the schema.
4. THE Next.js middleware SHALL enforce authentication checks for all protected routes, replacing per-route auth guards with a single centralized middleware layer.
5. WHEN TypeScript is configured, THE System SHALL enable `strict` mode in `tsconfig.json` to catch type errors at compile time.
6. THE System SHALL use the `server-only` package to mark server-side modules, preventing accidental import of server code in client components.
7. ALL API route handlers SHALL return responses using a consistent typed response helper that enforces the `{ "error": { "code": string, "message": string } }` error shape.
