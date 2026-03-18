# CI/CD Pipeline Documentation

This document describes the GitHub Actions CI/CD pipeline for NestPic. The pipeline runs on every
pull request and push to `main`, automating code quality checks, tests, build verification, and
Docker image publishing.

## Triggers

| Event | Jobs that run |
|---|---|
| Pull request (any branch) | `lint`, `type-check`, `unit-tests`, `e2e-tests`, `build` |
| Push to `main` | `lint`, `type-check`, `unit-tests`, `build`, `docker-publish` |
| Manual (`workflow_dispatch`) | All jobs (subject to their individual conditions) |

---

## Job Dependency Graph

```mermaid
graph TD
    A[lint] --> D[build]
    B[type-check] --> D[build]
    C[unit-tests] --> E[e2e-tests]
    A --> F[docker-publish]
    B --> F[docker-publish]
    C --> F[docker-publish]

    E:::prOnly
    F:::mainOnly

    classDef prOnly fill:#ddf,stroke:#66a
    classDef mainOnly fill:#fdf,stroke:#a6a
```

- Blue (`e2e-tests`): runs on pull requests only
- Pink (`docker-publish`): runs on push to `main` only
- `lint`, `type-check`, `unit-tests` run in parallel with no dependencies between them

---

## Jobs

### `lint`

**Purpose:** Runs ESLint against the TypeScript source to catch style and code-quality errors.

**Trigger:** Every pull request and push to `main`.

**Depends on:** nothing (runs in parallel with `type-check` and `unit-tests`).

**Inputs:**
- Source code (checked out from the repository)
- `node_modules` (restored from npm cache or installed via `npm ci`)

**Expected outputs:**
- Exit 0 if no ESLint errors; non-zero (fails the pipeline) if errors are found.
- No artifacts uploaded.

---

### `type-check`

**Purpose:** Runs the TypeScript compiler in no-emit mode to catch type errors without producing output files.

**Trigger:** Every pull request and push to `main`.

**Depends on:** nothing (runs in parallel with `lint` and `unit-tests`).

**Inputs:**
- Source code
- `node_modules`

**Expected outputs:**
- Exit 0 if no type errors; non-zero (fails the pipeline) if errors are found.
- No artifacts uploaded.

---

### `unit-tests`

**Purpose:** Runs the Vitest unit and property-based test suite and produces a JUnit XML report.

**Trigger:** Every pull request and push to `main`.

**Depends on:** nothing (runs in parallel with `lint` and `type-check`).

**Inputs:**
- Source code
- `node_modules`

**Expected outputs:**
- Exit 0 if all tests pass; non-zero (fails the pipeline) if any test fails.
- Artifact `unit-test-results` — `test-results/junit.xml` (uploaded even on failure, retained 30 days).

---

### `e2e-tests`

**Purpose:** Runs the Playwright end-to-end test suite against a live Next.js dev server backed by real PostgreSQL and Swift object-store containers.

**Trigger:** Pull requests only (`github.event_name == 'pull_request'`). Does not run on push to `main`.

**Depends on:** `unit-tests`.

**Inputs:**
- Source code
- `node_modules`
- Docker Compose test stack (`docker-compose.test.yml`) — PostgreSQL on port 5433, Swift on port 8081
- Playwright Chromium browser (installed during the job)
- Environment variables (hardcoded test values — see table below):

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5433/nestpic_test` |
| `OBJECT_STORE_ENDPOINT` | `http://localhost:8081` |
| `OBJECT_STORE_ACCESS_KEY` | `localdev` |
| `OBJECT_STORE_SECRET_KEY` | `localdev-secret` |
| `OBJECT_STORE_BUCKET` | `nestpic-test` |
| `SESSION_SECRET` | `test-session-secret-change-in-production-32c` |
| `CDN_BASE_URL` | `http://localhost:8081` |
| `CDN_KEY_PAIR_ID` | `local-key-pair-id` |
| `CDN_PRIVATE_KEY` | `local-private-key-placeholder` |
| `NODE_ENV` | `test` |
| `DISABLE_LOCAL_WORKER` | `true` |
| `RATE_LIMIT_DISABLED` | `true` |

**Expected outputs:**
- Exit 0 if all E2E tests pass; non-zero (fails the pipeline) if any test fails.
- Artifact `playwright-report` — `playwright-report/` HTML report and `test-results/` screenshots (uploaded even on failure, retained 30 days).
- Test services are always stopped (`docker compose down`) via `if: always()`.

---

### `build`

**Purpose:** Runs `next build` to verify the production build succeeds and uploads the compiled output.

**Trigger:** Every pull request and push to `main`.

**Depends on:** `lint`, `type-check`.

**Inputs:**
- Source code
- `node_modules`
- Stub environment variables (non-secret placeholders so `next build` can complete without real credentials):

| Variable | Stub value |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/nestpic` |
| `SESSION_SECRET` | `stub-session-secret-for-build-only-not-real` |
| `OBJECT_STORE_ENDPOINT` | `http://localhost:8080` |
| `OBJECT_STORE_ACCESS_KEY` | `stub` |
| `OBJECT_STORE_SECRET_KEY` | `stub` |
| `OBJECT_STORE_BUCKET` | `nestpic` |
| `CDN_BASE_URL` | `http://localhost:8080` |
| `CDN_KEY_PAIR_ID` | `stub` |
| `CDN_PRIVATE_KEY` | `stub` |
| `NODE_ENV` | `production` |

**Expected outputs:**
- Exit 0 if the build succeeds; non-zero (fails the pipeline) if the build fails.
- Artifact `next-build` — the `.next` directory (retained 7 days).

---

### `docker-publish`

**Purpose:** Builds the Docker image and pushes it to GitHub Container Registry (`ghcr.io`) with two tags: `:latest` and `:<git-sha>`.

**Trigger:** Push to `main` only (`github.event_name == 'push' && github.ref == 'refs/heads/main'`). Never runs on pull requests.

**Depends on:** `lint`, `type-check`, `unit-tests`.

**Inputs:**
- Source code + `Dockerfile`
- `GITHUB_TOKEN` (automatically provided by GitHub Actions — no manual configuration needed)
- Workflow-level permissions: `contents: read`, `packages: write`

**Expected outputs:**
- Docker image pushed to `ghcr.io/<owner>/<repo>:latest`
- Docker image pushed to `ghcr.io/<owner>/<repo>:<git-sha>` (first 7 chars of the commit SHA)
- Exit non-zero (fails the pipeline) if the build or push fails.
- No artifacts uploaded.

---

## GitHub Secrets

Only one secret is used by this pipeline, and it requires no manual configuration:

| Secret | Source | Used by | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | Automatically provided by GitHub Actions | `docker-publish` | Authenticates to `ghcr.io` to push the Docker image. GitHub generates this token for every workflow run. No repository administrator action is needed. |

No other secrets are required. E2E tests use hardcoded test credentials (matching `playwright.config.ts`), and the build job uses stub values — neither contains real credentials.

---

## Running CI Steps Locally

Use these commands to reproduce each CI check on your machine before pushing.

### Prerequisites

```bash
node --version   # should be v20.x
npm --version
docker --version
```

### Lint

```bash
npm run lint
```

### Type check

```bash
npx tsc --noEmit
```

### Unit tests

```bash
# Run once (no watch mode)
npm test -- --run

# With JUnit report (matches CI output)
npm test -- --reporter=junit --outputFile=test-results/junit.xml
```

### E2E tests

Start the test services first, wait for them to be healthy, then run Playwright:

```bash
# Start services
docker compose -f docker-compose.test.yml up -d

# Wait for healthy (poll until both containers report healthy)
until docker compose -f docker-compose.test.yml ps | grep -E "(healthy).*postgres-test" && \
      docker compose -f docker-compose.test.yml ps | grep -E "(healthy).*swift-test"; do
  echo "Waiting for services..."; sleep 3
done

# Install Playwright browser (first time only)
npx playwright install --with-deps chromium

# Run E2E tests
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/nestpic_test \
OBJECT_STORE_ENDPOINT=http://localhost:8081 \
OBJECT_STORE_ACCESS_KEY=localdev \
OBJECT_STORE_SECRET_KEY=localdev-secret \
OBJECT_STORE_BUCKET=nestpic-test \
SESSION_SECRET=test-session-secret-change-in-production-32c \
CDN_BASE_URL=http://localhost:8081 \
CDN_KEY_PAIR_ID=local-key-pair-id \
CDN_PRIVATE_KEY=local-private-key-placeholder \
NODE_ENV=test \
DISABLE_LOCAL_WORKER=true \
RATE_LIMIT_DISABLED=true \
npm run test:e2e

# Stop services when done
docker compose -f docker-compose.test.yml down
```

Alternatively, copy `.env.test` (which already contains these values) and run:

```bash
docker compose -f docker-compose.test.yml up -d
# wait for healthy as above
npm run test:e2e   # playwright.config.ts loads .env.test automatically
docker compose -f docker-compose.test.yml down
```

### Production build

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nestpic \
SESSION_SECRET=stub-session-secret-for-build-only-not-real \
OBJECT_STORE_ENDPOINT=http://localhost:8080 \
OBJECT_STORE_ACCESS_KEY=stub \
OBJECT_STORE_SECRET_KEY=stub \
OBJECT_STORE_BUCKET=nestpic \
CDN_BASE_URL=http://localhost:8080 \
CDN_KEY_PAIR_ID=stub \
CDN_PRIVATE_KEY=stub \
NODE_ENV=production \
npm run build
```

### Docker image build (local, no push)

```bash
docker build -t nestpic:local .
```

To push to `ghcr.io` manually (requires a personal access token with `write:packages`):

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u <your-github-username> --password-stdin
docker build -t ghcr.io/<owner>/<repo>:local .
docker push ghcr.io/<owner>/<repo>:local
```
