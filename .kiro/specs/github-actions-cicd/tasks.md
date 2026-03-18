# Implementation Plan: GitHub Actions CI/CD Pipeline

## Overview

Implement a single GitHub Actions workflow file (`.github/workflows/ci.yml`) with 6 jobs (lint, type-check, unit-tests, e2e-tests, build, docker-publish), property-based tests validating the workflow structure, and a `docs/cicd.md` documentation file.

## Tasks

- [x] 1. Create the GitHub Actions workflow file
  - Create `.github/workflows/ci.yml` with the `on:` triggers: `pull_request`, `push` to `main`, and `workflow_dispatch`
  - Add top-level `permissions: contents: read, packages: write`
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Implement the lint and type-check jobs
  - [x] 2.1 Add the `lint` job to `ci.yml`
    - Runs on `ubuntu-latest`, no `needs:` dependencies
    - Steps: checkout, setup-node@v4 with `node-version: '20'` and `cache: 'npm'`, `npm ci`, `npm run lint`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.3, 8.1_
  - [x] 2.2 Add the `type-check` job to `ci.yml`
    - Runs on `ubuntu-latest`, no `needs:` dependencies
    - Steps: checkout, setup-node@v4 with `node-version: '20'` and `cache: 'npm'`, `npm ci`, `npx tsc --noEmit`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2, 3.3, 8.1_

- [x] 3. Implement the unit-tests job
  - [x] 3.1 Add the `unit-tests` job to `ci.yml`
    - Runs on `ubuntu-latest`, no `needs:` dependencies (parallel with lint/type-check)
    - Steps: checkout, setup-node@v4, `npm ci`, run `npm test` with `--reporter=junit --outputFile=test-results/junit.xml`
    - Upload `test-results/junit.xml` as artifact using `if: always()`
    - _Requirements: 2.4, 4.1, 4.2, 4.3, 8.2_
  - [x] 3.2 Write property test for job runner and Node version invariants
    - **Property 1: All jobs run on ubuntu-latest**
    - **Property 2: All jobs use Node.js 20**
    - **Validates: Requirements 1.4, 2.4**
    - File: `src/__tests__/property/cicd.property.ts`
    - Parse `ci.yml` with a YAML library; use `fc.constantFrom(...jobNames)` to check each job

- [x] 4. Implement the e2e-tests job
  - [x] 4.1 Add the `e2e-tests` job to `ci.yml`
    - Condition: `if: github.event_name == 'pull_request'`
    - `needs: [unit-tests]`
    - Steps: checkout, setup-node@v4, `npm ci`
    - Start services: `docker compose -f docker-compose.test.yml up -d`
    - Health-check polling step with 60-second timeout; on failure print logs and exit 1
    - Install Playwright: `npx playwright install --with-deps chromium`
    - Run `npm run test:e2e` with all env vars from `playwright.config.ts` `webServer.env`
    - Upload Playwright HTML report and screenshots artifact using `if: always()`
    - Stop services: `docker compose -f docker-compose.test.yml down` using `if: always()`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 8.3_
  - [x] 4.2 Write property test for E2E env var consistency
    - **Property 3: E2E job environment variables match playwright.config.ts**
    - **Validates: Requirements 5.5**
    - Parse `playwright.config.ts` webServer env block and compare against the `e2e-tests` job env in `ci.yml`

- [x] 5. Implement the build job
  - [x] 5.1 Add the `build` job to `ci.yml`
    - `needs: [lint, type-check]`
    - Steps: checkout, setup-node@v4, `npm ci`, run `npm run build` with stub env vars
    - Upload `.next` directory as artifact with `retention-days: 7`
    - _Requirements: 6.1, 6.2, 6.3, 8.4_
  - [x] 5.2 Write property test for build job stub env vars
    - **Property 4: Build job defines all required environment variables**
    - **Validates: Requirements 6.2**
    - Read `.env.example` keys and verify each has a non-empty stub value in the `build` job env block

- [x] 6. Implement the docker-publish job
  - [x] 6.1 Add the `docker-publish` job to `ci.yml`
    - Condition: `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`
    - `needs: [lint, type-check, unit-tests]`
    - Steps: checkout, setup Docker Buildx (`docker/setup-buildx-action@v3`)
    - Login to `ghcr.io` via `docker/login-action@v3` using `${{ secrets.GITHUB_TOKEN }}`
    - Extract metadata with `docker/metadata-action@v5` producing `:latest` and `:<git-sha>` tags
    - Build and push with `docker/build-push-action@v5`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 8.4_
  - [x] 6.2 Write property tests for secret scoping and job dependency graph
    - **Property 5: No plaintext credentials in workflow YAML**
    - **Property 6: Secrets are scoped to jobs that need them**
    - **Property 7: Job dependency graph is correctly structured**
    - **Validates: Requirements 7.1, 7.2, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5**

- [x] 7. Checkpoint - Ensure all tests pass
  - Run `npm test -- --run` to verify unit and property tests pass
  - Verify `ci.yml` is valid YAML and all job names, triggers, and dependencies are correct
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Create CI/CD documentation
  - [x] 8.1 Create `docs/cicd.md`
    - Document each job: purpose, inputs, expected outputs
    - List all required GitHub Secrets (only `GITHUB_TOKEN`, auto-provided) with descriptions
    - Provide local equivalent commands for each CI step
    - Include the job dependency graph (mermaid or ASCII)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use **fast-check** + **vitest** (both already in `devDependencies`)
- The `GITHUB_TOKEN` secret is automatically provided by GitHub Actions — no manual secret configuration needed
- E2E env vars are non-sensitive test values and can be hardcoded in the workflow YAML
- All cleanup and artifact upload steps must use `if: always()` to run even on failure
