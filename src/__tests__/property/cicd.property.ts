import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

type WorkflowJob = {
  'runs-on': string;
  needs?: string | string[];
  steps?: Array<{
    uses?: string;
    run?: string;
    with?: Record<string, string>;
    env?: Record<string, string>;
    if?: string;
  }>;
  env?: Record<string, string>;
  if?: string;
};

type Workflow = {
  on: unknown;
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
};

let workflow: Workflow;
let jobNames: string[];
let playwrightEnv: Record<string, string>;

beforeAll(() => {
  const ciYmlPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
  const raw = fs.readFileSync(ciYmlPath, 'utf8');
  workflow = yaml.load(raw) as Workflow;
  jobNames = Object.keys(workflow.jobs);

  // Parse playwright.config.ts webServer.env by reading the file as text
  // and extracting the env block between `env: {` and the closing `}`
  const playwrightConfigPath = path.resolve(process.cwd(), 'playwright.config.ts');
  const configText = fs.readFileSync(playwrightConfigPath, 'utf8');
  const envBlockMatch = configText.match(/webServer:\s*\{[\s\S]*?env:\s*\{([\s\S]*?)\},/);
  playwrightEnv = {};
  if (envBlockMatch) {
    const envBlock = envBlockMatch[1];
    const entryRegex = /(\w+):\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = entryRegex.exec(envBlock)) !== null) {
      playwrightEnv[match[1]] = match[2];
    }
  }
});

describe('CI/CD workflow properties', () => {
  // Feature: github-actions-cicd, Property 1: All jobs run on ubuntu-latest
  it('Property 1: all jobs run on ubuntu-latest', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...(jobNames as [string, ...string[]])),
        (jobName) => {
          expect(workflow.jobs[jobName]['runs-on']).toBe('ubuntu-latest');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: github-actions-cicd, Property 2: All jobs use Node.js 20
  it('Property 2: all jobs with a setup-node step use node-version 20', () => {
    const jobsWithSetupNode = jobNames.filter((name) =>
      workflow.jobs[name].steps?.some((s) => s.uses?.startsWith('actions/setup-node'))
    );

    expect(jobsWithSetupNode.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.constantFrom(...(jobsWithSetupNode as [string, ...string[]])),
        (jobName) => {
          const setupNodeStep = workflow.jobs[jobName].steps!.find((s) =>
            s.uses?.startsWith('actions/setup-node')
          );
          expect(setupNodeStep?.with?.['node-version']).toBe('20');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: github-actions-cicd, Property 4: Build job defines all required environment variables
  it('Property 4: build job defines all required environment variables', () => {
    const envExamplePath = path.resolve(process.cwd(), '.env.example');
    const envExampleText = fs.readFileSync(envExamplePath, 'utf8');

    // Parse keys from .env.example, excluding comments and blank lines
    const allEnvKeys = envExampleText
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .map((line) => line.split('=')[0].trim())
      .filter(Boolean);

    // Exclude AWS Secrets Manager-specific keys and seed script keys (not needed for next build)
    const buildEnvKeys = allEnvKeys.filter(
      (key) => key !== 'SECRETS_MANAGER_SECRET_ARN' && !key.startsWith('SEED_')
    ) as [string, ...string[]];

    expect(buildEnvKeys.length).toBeGreaterThan(0);

    // Collect all env vars defined in the build job (job-level + step-level)
    const buildJob = workflow.jobs['build'];
    expect(buildJob).toBeDefined();

    const buildJobEnv: Record<string, string> = { ...(buildJob.env ?? {}) };
    for (const step of buildJob.steps ?? []) {
      if (step.env) Object.assign(buildJobEnv, step.env);
    }

    fc.assert(
      fc.property(
        fc.constantFrom(...buildEnvKeys),
        (envKey) => {
          expect(buildJobEnv).toHaveProperty(envKey);
          expect(String(buildJobEnv[envKey]).trim()).not.toBe('');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: github-actions-cicd, Property 3: E2E job env vars match playwright.config.ts
  it('Property 3: e2e-tests job env vars match playwright.config.ts webServer.env', () => {
    const envKeys = Object.keys(playwrightEnv) as [string, ...string[]];
    expect(envKeys.length).toBeGreaterThan(0);

    // Collect all env vars defined in the e2e-tests job (job-level + step-level)
    const e2eJob = workflow.jobs['e2e-tests'];
    expect(e2eJob).toBeDefined();

    const jobEnv: Record<string, string> = { ...(e2eJob.env ?? {}) };
    for (const step of e2eJob.steps ?? []) {
      if (step.env) Object.assign(jobEnv, step.env);
    }

    fc.assert(
      fc.property(
        fc.constantFrom(...envKeys),
        (envKey) => {
          expect(jobEnv).toHaveProperty(envKey);
          expect(String(jobEnv[envKey])).toBe(playwrightEnv[envKey]);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: github-actions-cicd, Property 5: No plaintext credentials in workflow YAML
  it('Property 5: no plaintext credentials in workflow YAML', () => {
    // Recursively collect all string values from the parsed workflow object
    function collectStrings(obj: unknown): string[] {
      if (typeof obj === 'string') return [obj];
      if (Array.isArray(obj)) return obj.flatMap(collectStrings);
      if (obj !== null && typeof obj === 'object') {
        return Object.values(obj as Record<string, unknown>).flatMap(collectStrings);
      }
      return [];
    }

    const knownSafeValues = [
      'localdev', 'localdev-secret', 'nestpic-test',
      'test-session-secret-change-in-production-32c',
      'local-key-pair-id', 'local-private-key-placeholder',
      'stub', 'stub-session-secret-for-build-only-not-real',
      'nestpic',
      'postgresql://postgres:postgres@localhost',
      'http://localhost',
      'ubuntu-latest', 'true', 'production', 'test', 'chromium', 'main',
    ];

    const allStrings = collectStrings(workflow);
    const stringValues = allStrings.filter((v) => {
      if (v.startsWith('${{')) return false;
      if (v === '') return false;
      if (/^\d+$/.test(v)) return false;
      // Check prefix against known safe values
      for (const safe of knownSafeValues) {
        if (v === safe || v.startsWith(safe)) return false;
      }
      return true;
    });

    if (stringValues.length === 0) return;

    fc.assert(
      fc.property(
        fc.constantFrom(...(stringValues as [string, ...string[]])),
        (value) => {
          // Should not look like base64-encoded secret (>20 chars, only base64 chars)
          const looksLikeBase64 = value.length > 20 && /^[A-Za-z0-9+/=]+$/.test(value);
          expect(looksLikeBase64).toBe(false);

          // Should not contain PEM header
          expect(value).not.toMatch(/-----BEGIN/);

          // Should not look like an AWS access key
          expect(value).not.toMatch(/AKIA[A-Z0-9]{16}/);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: github-actions-cicd, Property 6: Secrets are scoped to jobs that need them
  it('Property 6: secrets.GITHUB_TOKEN for registry auth only in docker-publish job', () => {
    const nonDockerJobNames = jobNames.filter((name) => name !== 'docker-publish') as [string, ...string[]];
    expect(nonDockerJobNames.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.constantFrom(...nonDockerJobNames),
        (jobName) => {
          const job = workflow.jobs[jobName];
          const envValues: string[] = [];

          // Collect job-level env values
          if (job.env) envValues.push(...Object.values(job.env));

          // Collect step-level env values
          for (const step of job.steps ?? []) {
            if (step.env) envValues.push(...Object.values(step.env));
          }

          for (const val of envValues) {
            expect(val).not.toBe('${{ secrets.GITHUB_TOKEN }}');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: github-actions-cicd, Property 7: Job dependency graph is correctly structured
  it('Property 7: job dependency graph is correctly structured', () => {
    const toArray = (n: string | string[] | undefined): string[] =>
      n == null ? [] : Array.isArray(n) ? n : [n];

    expect(toArray(workflow.jobs['lint']?.needs)).toHaveLength(0);
    expect(toArray(workflow.jobs['type-check']?.needs)).toHaveLength(0);
    expect(toArray(workflow.jobs['unit-tests']?.needs)).toHaveLength(0);

    expect(toArray(workflow.jobs['e2e-tests']?.needs)).toContain('unit-tests');

    const buildNeeds = toArray(workflow.jobs['build']?.needs);
    expect(buildNeeds).toContain('lint');
    expect(buildNeeds).toContain('type-check');

    const dockerNeeds = toArray(workflow.jobs['docker-publish']?.needs);
    expect(dockerNeeds).toContain('lint');
    expect(dockerNeeds).toContain('type-check');
    expect(dockerNeeds).toContain('unit-tests');
  });
});
