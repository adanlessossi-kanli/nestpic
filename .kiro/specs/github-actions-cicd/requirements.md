# Requirements Document

## Introduction

This feature adds a CI pipeline for the NestPic photo-sharing application using GitHub Actions.
The pipeline automates code quality checks, unit/property tests, E2E tests, and build validation
on every pull request and push to the main branch. On push to `main`, the pipeline also builds
and pushes a Docker image to GitHub Container Registry (ghcr.io). All jobs run on GitHub-hosted
`ubuntu-latest` runners. The pipeline uses the existing Docker Compose test stack (PostgreSQL +
Swift object store) and Playwright E2E suite.

## Glossary

- **CI_Pipeline**: The GitHub Actions workflow that runs on pull requests and pushes to `main`.
- **Docker_Publish_Job**: The job that builds the Docker image and pushes it to GitHub Container Registry (ghcr.io), triggered only on push to `main`.
- **Lint_Job**: The job that runs ESLint against the TypeScript source.
- **Type_Check_Job**: The job that runs the TypeScript compiler in no-emit mode.
- **Unit_Test_Job**: The job that runs Vitest unit and property-based tests.
- **E2E_Test_Job**: The job that runs Playwright end-to-end tests against a live app and test services.
- **Build_Job**: The job that runs `next build` to verify the production build succeeds.
- **Test_Services**: The Docker-based PostgreSQL and Swift containers defined in `docker-compose.test.yml`.
- **Secrets**: GitHub Actions encrypted secrets used to supply sensitive environment variables.
- **Artifact**: A file or directory uploaded to GitHub Actions artifact storage for later inspection.
- **Cache**: GitHub Actions dependency cache used to speed up `npm install` across runs.

---

## Requirements

### Requirement 1: Continuous Integration Trigger

**User Story:** As a developer, I want the CI pipeline to run automatically on every pull request and push to `main`, so that regressions are caught before code is merged.

#### Acceptance Criteria

1. WHEN a pull request is opened or updated against any branch, THE CI_Pipeline SHALL trigger automatically.
2. WHEN a commit is pushed to the `main` branch, THE CI_Pipeline SHALL trigger automatically.
3. THE CI_Pipeline SHALL allow manual triggering via `workflow_dispatch`.
4. THE CI_Pipeline SHALL run all jobs on GitHub-hosted `ubuntu-latest` runners.

---

### Requirement 2: Dependency Installation and Caching

**User Story:** As a developer, I want npm dependencies to be cached between runs, so that pipeline execution time is minimised.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL restore the `node_modules` cache keyed on the hash of `package-lock.json` before installing dependencies.
2. WHEN the cache key matches an existing cache entry, THE CI_Pipeline SHALL skip `npm ci` and use the cached modules.
3. WHEN no matching cache entry exists, THE CI_Pipeline SHALL run `npm ci` and save the resulting `node_modules` to the cache.
4. THE CI_Pipeline SHALL use Node.js 20 as the runtime version for all jobs.

---

### Requirement 3: Lint and Type Checking

**User Story:** As a developer, I want linting and type checking to run in CI, so that code style and type errors are caught on every change.

#### Acceptance Criteria

1. THE Lint_Job SHALL run `npm run lint` and fail the pipeline if ESLint reports any errors.
2. THE Type_Check_Job SHALL run `npx tsc --noEmit` and fail the pipeline if the TypeScript compiler reports any errors.
3. WHEN the Lint_Job or Type_Check_Job fails, THE CI_Pipeline SHALL report the failure without running subsequent dependent jobs.

---

### Requirement 4: Unit and Property-Based Tests

**User Story:** As a developer, I want unit and property-based tests to run in CI, so that logic regressions are detected automatically.

#### Acceptance Criteria

1. THE Unit_Test_Job SHALL run `npm test` (Vitest) and fail the pipeline if any test fails.
2. THE Unit_Test_Job SHALL produce a JUnit-compatible XML test report and upload it as an Artifact.
3. WHEN the Unit_Test_Job fails, THE CI_Pipeline SHALL upload the test report Artifact regardless of job outcome.

---

### Requirement 5: End-to-End Tests

**User Story:** As a developer, I want E2E tests to run in CI on every pull request against real backing services, so that integration regressions are caught before merge.

#### Acceptance Criteria

1. THE E2E_Test_Job SHALL run on every pull request opened or updated against any branch.
2. THE E2E_Test_Job SHALL start the Test_Services (PostgreSQL and Swift) using `docker compose -f docker-compose.test.yml up -d` before running tests.
3. THE E2E_Test_Job SHALL wait for Test_Services to report healthy before proceeding.
4. THE E2E_Test_Job SHALL install Playwright browsers via `npx playwright install --with-deps chromium`.
5. THE E2E_Test_Job SHALL run `npm run test:e2e` with the environment variables matching those defined in `playwright.config.ts` for the test web server.
6. WHEN the E2E_Test_Job completes, THE CI_Pipeline SHALL upload the Playwright HTML report and any failure screenshots as Artifacts, regardless of job outcome.
7. THE E2E_Test_Job SHALL stop and remove Test_Services containers after the test run completes.
8. IF the Test_Services fail to become healthy within 60 seconds, THEN THE E2E_Test_Job SHALL fail with a descriptive error message.

---

### Requirement 6: Production Build Verification

**User Story:** As a developer, I want the production Next.js build to be verified in CI, so that build-breaking changes are caught before deployment.

#### Acceptance Criteria

1. THE Build_Job SHALL run `npm run build` and fail the pipeline if the Next.js build exits with a non-zero code.
2. THE Build_Job SHALL supply the minimum required environment variables (non-secret stubs) so that `next build` can complete without real credentials.
3. WHEN the Build_Job succeeds, THE CI_Pipeline SHALL upload the `.next` build output as an Artifact with a 7-day retention period.

---

### Requirement 7: Secret and Environment Variable Management

**User Story:** As a developer, I want sensitive credentials to be stored as GitHub Secrets and never hard-coded in workflow files, so that the repository remains secure.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL read all sensitive values (database passwords, object store keys, session secrets) exclusively from GitHub Actions Secrets.
2. THE CI_Pipeline SHALL NOT include any plaintext credentials in workflow YAML files.
3. THE CI_Pipeline SHALL document all required Secrets in the CI/CD documentation file so that repository administrators know which Secrets to configure.
4. WHERE a Secret is not required for a specific job (e.g., lint), THE CI_Pipeline SHALL NOT pass that Secret to the job environment.

---

### Requirement 8: Job Dependency and Parallelism

**User Story:** As a developer, I want independent jobs to run in parallel and dependent jobs to run in the correct order, so that feedback is fast and failures are isolated.

#### Acceptance Criteria

1. THE Lint_Job and Type_Check_Job SHALL run in parallel with no dependencies between them.
2. THE Unit_Test_Job SHALL run in parallel with the Lint_Job and Type_Check_Job.
3. THE E2E_Test_Job SHALL depend on the Unit_Test_Job completing successfully.
4. THE Build_Job SHALL depend on the Lint_Job and Type_Check_Job completing successfully.
5. WHEN any required job fails, THE CI_Pipeline SHALL skip all downstream dependent jobs and mark the overall workflow as failed.

---

### Requirement 9: Pipeline Status Reporting

**User Story:** As a developer, I want clear pass/fail status checks on pull requests, so that I can see at a glance whether a PR is safe to merge.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL report a named status check for each job to the GitHub pull request.
2. WHEN all jobs pass, THE CI_Pipeline SHALL report an overall success status on the pull request.
3. WHEN any job fails, THE CI_Pipeline SHALL report a failure status on the pull request with a link to the failing job logs.

---

### Requirement 10: Docker Image Build and Push to GitHub Container Registry

**User Story:** As a developer, I want the Docker image to be built and pushed to ghcr.io on every push to `main`, so that a versioned image is always available after a successful merge.

#### Acceptance Criteria

1. WHEN a commit is pushed to the `main` branch, THE Docker_Publish_Job SHALL build the Docker image using the repository's `Dockerfile`.
2. THE Docker_Publish_Job SHALL authenticate to GitHub Container Registry (`ghcr.io`) using the `GITHUB_TOKEN` secret provided by GitHub Actions.
3. THE Docker_Publish_Job SHALL tag the image as `ghcr.io/<owner>/<repo>:latest` and `ghcr.io/<owner>/<repo>:<git-sha>`.
4. THE Docker_Publish_Job SHALL push both tags to `ghcr.io` and fail the pipeline if the push exits with a non-zero code.
5. THE Docker_Publish_Job SHALL depend on the Lint_Job, Type_Check_Job, and Unit_Test_Job completing successfully before running.
6. THE Docker_Publish_Job SHALL NOT run on pull request events; it SHALL run only on push to `main`.

---

### Requirement 11: CI/CD Documentation

**User Story:** As a developer, I want the CI/CD setup to be documented, so that new contributors can understand, run, and extend the pipeline.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL include a `docs/cicd.md` documentation file in the repository.
2. THE `docs/cicd.md` file SHALL describe each workflow job, its purpose, its inputs, and its expected outputs.
3. THE `docs/cicd.md` file SHALL list all GitHub Secrets that must be configured, with a description of each.
4. THE `docs/cicd.md` file SHALL provide instructions for running the equivalent checks locally before pushing.
5. THE `docs/cicd.md` file SHALL document the job dependency graph so developers understand the execution order.
