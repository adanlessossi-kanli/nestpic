# Design Document: GitHub Actions CI/CD Pipeline

## Overview

This document describes the design for a GitHub Actions CI pipeline for the NestPic photo-sharing application. The pipeline automates linting, type checking, unit/property tests, E2E tests, production build verification, and Docker image publishing on every pull request and push to `main`.

The pipeline is implemented as a single GitHub Actions workflow file (`.github/workflows/ci.yml`) containing multiple jobs that run in parallel where possible and in dependency order where required. All jobs run on GitHub-hosted `ubuntu-latest` runners with Node.js 20.

Key design decisions:
- Single workflow file with multiple jobs (simpler than multiple workflow files, easier to see the full picture)
- `npm ci` with `node_modules` cache keyed on `package-lock.json` hash (faster than re-installing every run)
- E2E tests use `docker-compose.test.yml` (existing isolated test stack on separate ports)
- Docker image pushed to `ghcr.io` using `GITHUB_TOKEN` (no extra secret needed for registry auth)
- Docker publish only on push to `main`, never on PRs

## Architecture

The pipeline is a directed acyclic graph (DAG) of jobs:

```mermaid
graph TD
    A[lint] --> D[build]
    B[type-check] --> D[build]
    C[unit-tests] --> E[e2e-tests]
    A --> F[docker-publish]
    B --> F[docker-publish]
    C --> F[docker-publish]

    style F fill:#f9f,stroke:#333
    note1["docker-publish: main branch only"]
```

Job execution summary:

| Job | Trigger | Depends On | Runs On |
|---|---|---|---|
| `lint` | PR + push to main | — | ubuntu-latest |
| `type-check` | PR + push to main | — | ubuntu-latest |
| `unit-tests` | PR + push to main | — | ubuntu-latest |
| `e2e-tests` | PR only | `unit-tests` | ubuntu-latest |
| `build` | PR + push to main | `lint`, `type-check` | ubuntu-latest |
| `docker-publish` | push to main only | `lint`, `type-check`, `unit-tests` | ubuntu-latest |

## Components and Interfaces

### Workflow File: `.github/workflows/ci.yml`

The single workflow file defines all jobs. It is triggered by:
- `pull_request` on any branch
- `push` to `main`
- `workflow_dispatch` (manual trigger)

#### Job: `lint`
- Checks out code
- Sets up Node.js 20 with npm cache
- Runs `npm ci` (or restores cache)
- Runs `npm run lint`
- No secrets required

#### Job: `type-check`
- Checks out code
- Sets up Node.js 20 with npm cache
- Runs `npm ci` (or restores cache)
- Runs `npx tsc --noEmit`
- No secrets required

#### Job: `unit-tests`
- Checks out code
- Sets up Node.js 20 with npm cache
- Runs `npm ci` (or restores cache)
- Runs `npm test` with `--reporter=junit` output to `test-results/junit.xml`
- Uploads `test-results/junit.xml` as artifact (always, even on failure)
- No secrets required

#### Job: `e2e-tests`
- Runs only on `pull_request` events (conditional: `github.event_name == 'pull_request'`)
- Depends on `unit-tests`
- Checks out code
- Sets up Node.js 20 with npm cache
- Runs `npm ci` (or restores cache)
- Starts test services: `docker compose -f docker-compose.test.yml up -d`
- Waits for services to be healthy (polls with timeout, fails with descriptive error after 60s)
- Installs Playwright browsers: `npx playwright install --with-deps chromium`
- Runs `npm run test:e2e` with environment variables from `playwright.config.ts`
- Uploads Playwright HTML report and screenshots as artifact (always)
- Stops services: `docker compose -f docker-compose.test.yml down`
- Secrets required: none (test services use hardcoded test credentials)

#### Job: `build`
- Depends on `lint`, `type-check`
- Checks out code
- Sets up Node.js 20 with npm cache
- Runs `npm ci` (or restores cache)
- Runs `npm run build` with stub environment variables
- Uploads `.next` directory as artifact with 7-day retention
- Secrets required: none (stub values used)

#### Job: `docker-publish`
- Runs only on `push` to `main` (conditional: `github.event_name == 'push' && github.ref == 'refs/heads/main'`)
- Depends on `lint`, `type-check`, `unit-tests`
- Checks out code
- Sets up Docker Buildx
- Logs in to `ghcr.io` using `GITHUB_TOKEN`
- Extracts metadata (tags: `latest` + `<git-sha>`)
- Builds and pushes image to `ghcr.io/<owner>/<repo>`
- Uses `docker/metadata-action`, `docker/login-action`, `docker/build-push-action`

### Caching Strategy

The `actions/setup-node` action's built-in npm cache is used:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'npm'
```

This caches `~/.npm` keyed on `package-lock.json` hash. When the cache hits, `npm ci` still runs but is fast because packages are already in the npm cache. This is the standard approach recommended by GitHub Actions.

### Service Health Check

The E2E job needs both PostgreSQL and Swift to be healthy before running tests. The `docker-compose.test.yml` already defines healthchecks for both services. The job will use a polling loop:

```bash
echo "Waiting for services to be healthy..."
timeout 60 bash -c 'until docker compose -f docker-compose.test.yml ps | grep -E "(healthy).*postgres-test" && docker compose -f docker-compose.test.yml ps | grep -E "(healthy).*swift-test"; do sleep 3; done' \
  || (echo "ERROR: Test services failed to become healthy within 60 seconds" && docker compose -f docker-compose.test.yml logs && exit 1)
```

### Docker Image Tagging

Two tags are applied on every push to `main`:
- `ghcr.io/<owner>/<repo>:latest` — always points to the most recent main build
- `ghcr.io/<owner>/<repo>:<git-sha>` — immutable reference to a specific commit (first 7 chars of SHA)

The `docker/metadata-action` handles tag generation automatically from `github.sha` and `github.ref`.

### Artifact Retention

| Artifact | Retention |
|---|---|
| JUnit test report | 30 days (default) |
| Playwright HTML report + screenshots | 30 days (default) |
| `.next` build output | 7 days (explicit) |

### Documentation File: `docs/cicd.md`

A markdown file committed to the repository documenting:
- Each job's purpose, inputs, and outputs
- All required GitHub Secrets
- Local equivalent commands for each CI step
- Job dependency graph

## Data Models

### GitHub Actions Workflow Structure

The workflow YAML has this top-level structure:

```yaml
name: CI

on:
  pull_request:        # all branches
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  lint: { ... }
  type-check: { ... }
  unit-tests: { ... }
  e2e-tests: { ... }
  build: { ... }
  docker-publish: { ... }
```

### Environment Variables for E2E Job

These match the values in `playwright.config.ts` `webServer.env`:

| Variable | Value in CI |
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

These are non-sensitive test values and can be hardcoded in the workflow YAML (they match what's already in `playwright.config.ts`).

### Environment Variables for Build Job (Stubs)

`next build` requires certain env vars to be present at build time. Stub values are used:

| Variable | Stub Value |
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

### Required GitHub Secrets

For this pipeline, no secrets are strictly required because:
- E2E tests use hardcoded test credentials (same as `playwright.config.ts`)
- Build job uses stub values
- Docker publish uses `GITHUB_TOKEN` (automatically provided by GitHub Actions)

The `GITHUB_TOKEN` is automatically available — no manual configuration needed. The `packages: write` permission must be granted in the workflow:

```yaml
permissions:
  contents: read
  packages: write
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The workflow YAML is a configuration artifact that can be parsed and validated programmatically. The properties below are expressed as structural invariants over the parsed YAML, testable with a YAML parser and a property-based testing library.

### Property 1: All jobs run on ubuntu-latest

*For any* job defined in the workflow YAML, its `runs-on` field SHALL equal `ubuntu-latest`.

**Validates: Requirements 1.4**

### Property 2: All jobs use Node.js 20

*For any* job defined in the workflow YAML that contains a `setup-node` step, that step's `node-version` input SHALL equal `'20'`.

**Validates: Requirements 2.4**

### Property 3: E2E job environment variables match playwright.config.ts

*For any* environment variable defined in the `webServer.env` block of `playwright.config.ts`, the `e2e-tests` job in the workflow YAML SHALL define that same variable with the same value in its `env` block or step `env`.

**Validates: Requirements 5.5**

### Property 4: Build job defines all required environment variables

*For any* environment variable key present in `.env.example` that is not AWS Secrets Manager-specific, the `build` job in the workflow YAML SHALL define a non-empty stub value for that variable.

**Validates: Requirements 6.2**

### Property 5: No plaintext credentials in workflow YAML

*For any* string value in the workflow YAML, it SHALL NOT match patterns that indicate real credentials (e.g., actual passwords, private keys, or tokens that are not `${{ secrets.* }}` references or known test stub values).

**Validates: Requirements 7.1, 7.2**

### Property 6: Secrets are scoped to jobs that need them

*For any* job in the workflow YAML that is not `docker-publish`, that job's `env` blocks SHALL NOT reference `secrets.GITHUB_TOKEN` for registry authentication or any other non-automatic secret.

**Validates: Requirements 7.4**

### Property 7: Job dependency graph is correctly structured

*For any* pair of jobs (A, B) in the workflow, the `needs:` relationship SHALL satisfy:
- `lint` and `type-check` have no `needs:` (run in parallel, no dependencies)
- `unit-tests` has no `needs:` referencing `lint` or `type-check` (runs in parallel with them)
- `e2e-tests` has `needs:` containing `unit-tests`
- `build` has `needs:` containing both `lint` and `type-check`
- `docker-publish` has `needs:` containing `lint`, `type-check`, and `unit-tests`

**Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

## Error Handling

### Service Health Check Timeout

If `postgres-test` or `swift-test` fail to become healthy within 60 seconds, the health-check polling step exits with code 1 and prints:
```
ERROR: Test services failed to become healthy within 60 seconds
```
followed by `docker compose logs` output to aid debugging. The job then fails, and the `docker compose down` cleanup step still runs (via `if: always()`).

### Build Failures

Each job fails fast on non-zero exit codes (default GitHub Actions behavior). No special error handling is needed beyond ensuring cleanup steps use `if: always()`.

### Docker Push Failures

The `docker/build-push-action` action fails the job on any push error. No retry logic is added — a failed push is surfaced immediately as a workflow failure.

### Artifact Upload on Failure

Both the unit test report and the Playwright report upload steps use `if: always()` to ensure artifacts are available for debugging even when the test step fails.

### Service Cleanup

The `docker compose down` step in the E2E job uses `if: always()` to ensure containers are stopped and removed even if tests fail or the health check times out. This prevents resource leaks on the runner.

## Testing Strategy

### Dual Testing Approach

The CI pipeline itself (the workflow YAML and documentation) is tested using two complementary approaches:

**Unit tests** (specific examples and structural checks):
- Verify the workflow YAML parses as valid YAML
- Verify specific structural elements exist (triggers, job names, commands, artifact upload steps)
- Verify `docs/cicd.md` exists and contains required sections
- Verify the `if: always()` condition is present on cleanup and artifact upload steps
- Verify the docker-publish job has the correct trigger condition

**Property-based tests** (universal properties across the workflow structure):
- For all jobs: `runs-on` is `ubuntu-latest`
- For all jobs with a setup-node step: `node-version` is `'20'`
- For all env vars in `playwright.config.ts`: they appear in the e2e job
- For all required env vars: the build job has stub values
- For all jobs except docker-publish: no registry secrets are referenced
- The job dependency graph satisfies the required structure

### Property-Based Testing Library

Use **fast-check** (already in `devDependencies`) with **vitest** for property tests. Tests live in `src/__tests__/property/cicd.property.ts`.

Each property test runs a minimum of **100 iterations** (though for YAML structure tests, the "randomness" comes from generating random subsets of jobs/env vars to check, not from random YAML generation).

### Test Tags

Each property test is tagged with a comment referencing the design property:

```typescript
// Feature: github-actions-cicd, Property 1: All jobs run on ubuntu-latest
it.prop([fc.constantFrom(...jobNames)])('all jobs use ubuntu-latest', (jobName) => {
  expect(workflow.jobs[jobName]['runs-on']).toBe('ubuntu-latest')
})
```

### Unit Test Balance

Unit tests focus on:
- Specific structural checks (trigger configuration, command strings, artifact paths)
- Edge cases (cleanup steps use `if: always()`, docker-publish is gated to main)
- Documentation completeness (docs/cicd.md sections)

Property tests focus on:
- Universal invariants over all jobs (runner, Node version, secret scoping)
- Cross-file consistency (env vars match between playwright.config.ts and workflow YAML)

Together they provide comprehensive coverage: unit tests catch concrete structural bugs, property tests verify general correctness invariants across the entire workflow.
