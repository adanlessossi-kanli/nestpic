# Nestpic

A private, invite-only family photo and video sharing platform built with Next.js 14 (App Router), TypeScript, PostgreSQL, and Amazon S3 / OpenStack Swift.

Family members can upload photos and videos, browse a shared feed, organize media into albums, and invite new members — all in a closed, authenticated environment.

---

## Features

- **Invite-only registration** — existing members generate single-use invitation links (72-hour expiry)
- **Media upload** — direct-to-S3 uploads via presigned URLs with client-side progress display; supports JPEG, PNG, GIF, WebP, MP4, MOV, AVI up to 200 MB
- **Thumbnail generation** — async thumbnail generation via AWS Lambda (S3 event trigger) or a local background worker; photos resized to 400px, videos extract first frame
- **Family feed** — reverse-chronological feed with infinite scroll pagination (30 items/page)
- **Albums** — create named albums, add media to multiple albums, delete albums without losing media
- **Lightbox & video player** — full-resolution photo lightbox with prev/next navigation; HTML5 video player with play/pause/seek
- **Media deletion** — owners can delete their own media; removes S3 objects, thumbnails, and all album associations
- **Responsive layout** — 1/2/3-column grid adapting from 320px to 2560px viewports

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript (strict mode) |
| Database | PostgreSQL 15 (Amazon RDS) |
| Object storage | Amazon S3 (prod) / OpenStack Swift (dev) |
| CDN | Amazon CloudFront with signed URLs |
| Auth | iron-session (HttpOnly cookies, session rotation) |
| Password hashing | bcrypt (cost factor ≥ 12) |
| Input validation | Zod |
| Thumbnail processing | sharp + fluent-ffmpeg |
| Secrets (prod) | AWS Secrets Manager |
| Unit/property tests | Vitest + fast-check + pg-mem |
| E2E tests | Playwright |

---

## Project Structure

```
nestpic/
├── migrations/          # SQL migration files
├── scripts/             # DB migrate, seed, E2E seed
├── src/
│   ├── app/             # Next.js App Router pages and API routes
│   │   ├── api/         # REST API handlers
│   │   ├── feed/        # Feed page
│   │   ├── albums/      # Albums list + detail pages
│   │   ├── signin/      # Sign-in page
│   │   └── register/    # Invitation registration page
│   ├── components/      # Shared React components
│   ├── lambda/          # AWS Lambda thumbnail handler
│   ├── lib/             # Server-side utilities
│   │   ├── api/         # Typed response helpers
│   │   ├── auth/        # Session management
│   │   ├── objectStore/ # S3 / Swift abstraction
│   │   ├── schemas/     # Zod validation schemas
│   │   ├── thumbnail/   # Thumbnail processor + local worker
│   │   └── upload/      # File validation + cleanup job
│   ├── middleware.ts     # Auth enforcement + security headers
│   └── __tests__/       # Unit and property-based tests
├── e2e/                 # Playwright E2E tests + Page Object Models
├── docker-compose.yml       # Local dev services
└── docker-compose.test.yml  # Isolated E2E test services
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your local values. The defaults work with the Docker Compose services below:

```env
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nestpic
OBJECT_STORE_ENDPOINT=http://localhost:8080
OBJECT_STORE_ACCESS_KEY=your-access-key
OBJECT_STORE_SECRET_KEY=your-secret-key
OBJECT_STORE_BUCKET=nestpic
SESSION_SECRET=change-me-to-a-long-random-string-at-least-32-chars
CDN_BASE_URL=http://localhost:8080
CDN_KEY_PAIR_ID=local-key-pair-id
CDN_PRIVATE_KEY=local-private-key-placeholder
```

### 3. Start local services

```bash
docker compose up -d
```

This starts PostgreSQL (port 5432) and OpenStack Swift (port 8080). Add `--profile worker` to also start the local thumbnail worker container.

### 4. Run database migrations

```bash
npm run db:migrate
```

### 5. Seed initial data (optional)

```bash
npm run db:seed
```

### 6. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

All required variable names are documented in `.env.example`. No real secrets are committed to the repository.

| Variable | Description |
|---|---|
| `NODE_ENV` | `development` uses OpenStack Swift; `production` uses S3 + Secrets Manager |
| `DATABASE_URL` | PostgreSQL connection string |
| `OBJECT_STORE_ENDPOINT` | S3 or Swift endpoint URL |
| `OBJECT_STORE_ACCESS_KEY` | Object store access key |
| `OBJECT_STORE_SECRET_KEY` | Object store secret key |
| `OBJECT_STORE_BUCKET` | Bucket / container name |
| `SESSION_SECRET` | iron-session encryption secret (≥ 32 chars) |
| `CDN_BASE_URL` | CloudFront distribution URL (or Swift URL in dev) |
| `CDN_KEY_PAIR_ID` | CloudFront key pair ID for signed URLs |
| `CDN_PRIVATE_KEY` | CloudFront RSA private key for signed URLs |
| `SECRETS_MANAGER_SECRET_ARN` | AWS Secrets Manager ARN (production only) |

In production, `DATABASE_URL`, `SESSION_SECRET`, `CDN_PRIVATE_KEY`, and object store credentials are fetched from AWS Secrets Manager at startup rather than read from environment variables.

---

## Available Scripts

```bash
npm run dev          # Start Next.js development server
npm run build        # Production build
npm run start        # Start production server
npm run db:migrate   # Run SQL migrations
npm run db:seed      # Seed development data
npm run test         # Run unit + property tests (vitest --run)
npm run test:e2e     # Run Playwright E2E tests
npm run lint         # ESLint
```

---

## Testing

### Unit and Property Tests

Tests run against an in-memory PostgreSQL instance (`pg-mem`) and a mock object store — no real AWS credentials or running services needed.

```bash
npm run test
```

Property-based tests use [fast-check](https://github.com/dubzzz/fast-check) with a minimum of 100 iterations per property. Each property is tagged with a comment referencing the design property it validates:

```typescript
// Feature: nestpic-app, Property 5: File validation rejects invalid inputs
```

### E2E Tests

E2E tests use Playwright against a locally running Next.js instance backed by isolated Docker services.

**Start the E2E services first:**

```bash
docker compose -f docker-compose.test.yml up -d
```

**Then run the tests:**

```bash
npm run test:e2e
```

The Playwright config (`playwright.config.ts`) automatically starts the Next.js dev server pointed at the test database (port 5433) and test Swift instance (port 8081). A global setup script seeds test users before the suite runs.

Test results are written to an HTML report (`playwright-report/`). On failure, screenshots and traces are captured automatically.

E2E tests follow the Page Object Model pattern — page interactions are encapsulated in `e2e/pages/`.

---

## API Reference

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/signin` | Sign in with email + password |
| `POST` | `/api/auth/signout` | Invalidate session |
| `GET` | `/api/auth/session` | Get current session info |
| `POST` | `/api/auth/invite` | Generate invitation link (auth required) |
| `POST` | `/api/auth/register` | Register via invitation token |

### Upload

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/upload/presign` | Get presigned S3 PUT URL |
| `POST` | `/api/upload/confirm` | Confirm upload complete, activate media record |

### Feed & Media

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/feed` | Paginated feed (`?cursor=<uploaded_at>`) |
| `GET` | `/api/media/:id` | Single media item with signed CDN URL |
| `DELETE` | `/api/media/:id` | Delete media (owner only) |

### Albums

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/albums` | List all albums |
| `POST` | `/api/albums` | Create album |
| `GET` | `/api/albums/:id` | Album contents (paginated) |
| `POST` | `/api/albums/:id/media` | Add media to album |
| `DELETE` | `/api/albums/:id` | Delete album (preserves media) |

### Cron

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/cron/cleanup-pending` | Delete stale pending media older than 1 hour |

All error responses follow the shape:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

---

## Architecture

```
Browser
  │
  ├─ All requests ──► Next.js middleware.ts
  │                     (auth check + security headers)
  │                         │
  │                         ▼
  │                   Next.js API Routes / SSR
  │                         │
  ├─ Direct PUT ──────────► S3 / OpenStack Swift
  │  (presigned URL)        │
  │                         ├─ S3 event ──► Lambda thumbnail handler
  │                         │               (or local background worker)
  │                         │
  ├─ Media fetch ─────────► CloudFront CDN ──► S3
  │  (signed URL)
  │
  └─ Metadata ────────────► RDS PostgreSQL
                             (via RDS Proxy in production)
```

### Storage Abstraction

The `ObjectStore` interface (`src/lib/objectStore/types.ts`) provides a consistent API regardless of backend:

```typescript
interface ObjectStore {
  generatePresignedPutUrl(key, contentType, contentLength, expiresIn): Promise<string>
  generateSignedGetUrl(key, expiresIn): Promise<string>
  deleteObject(key): Promise<void>
  headObject(key): Promise<{ contentLength: number; contentType: string }>
}
```

- `NODE_ENV=development` → `SwiftAdapter` (uses a local dev proxy at `/api/dev-upload`)
- `NODE_ENV=production` → `S3Adapter` (CloudFront signed URLs, Content-Type/Content-Length constraints on PUT)

### Security

- **Session rotation** on every sign-in (prevents session fixation)
- **HttpOnly, Secure, SameSite=Lax** session cookies
- **bcrypt** password hashing with cost factor ≥ 12
- **Constant-time** invitation token comparison (`crypto.timingSafeEqual`)
- **Rate limiting** — sign-in: 10 req/min/IP; invite: 5 req/hr/user; register: 5 req/hr/IP
- **Security headers** on all responses via middleware: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **Zod validation** on all API route inputs
- **`server-only`** package prevents accidental client-side imports of server modules
- **Presigned PUT URLs** constrained with Content-Type and Content-Length to prevent spoofing

---

## Database Schema

| Table | Purpose |
|---|---|
| `users` | Family member accounts |
| `sessions` | Server-side session records (7-day expiry) |
| `invitations` | Single-use registration tokens (72-hour expiry) |
| `media` | Photo/video metadata and S3 keys |
| `albums` | Named media collections |
| `album_media` | Many-to-many media ↔ album associations |
| `rate_limit_buckets` | Request count tracking per key/window |

See `migrations/001_initial.sql` for the full schema.

---

## Thumbnail Lambda

`src/lambda/thumbnailHandler.ts` exports a handler triggered by S3 `ObjectCreated` events on the `originals/` prefix. It calls the shared `processMedia` function (also used by the local worker) to generate a JPEG thumbnail and record the key in the database.

Failed events are routed to an SQS Dead Letter Queue (DLQ) configured in the infrastructure layer. See `src/lambda/README.md` for deployment notes.

---

## License

MIT
