import 'server-only';
import type { ObjectStore } from './types';

const REQUIRED_ENV_VARS = [
  'OBJECT_STORE_ENDPOINT',
  'OBJECT_STORE_ACCESS_KEY',
  'OBJECT_STORE_SECRET_KEY',
  'OBJECT_STORE_BUCKET',
] as const;

export type ObjectStoreConfig = {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  cdnBaseUrl?: string;
  cdnKeyPairId?: string;
  cdnPrivateKey?: string;
};

function validateConfig(vars: Record<string, string | undefined>): ObjectStoreConfig {
  const missing = REQUIRED_ENV_VARS.filter((key) => !vars[key]);
  if (missing.length > 0) {
    throw new Error(
      `Object store configuration error: missing required environment variable(s): ${missing.join(', ')}. ` +
        `Check your .env.local file or AWS Secrets Manager configuration.`
    );
  }

  return {
    endpoint: vars['OBJECT_STORE_ENDPOINT']!,
    accessKey: vars['OBJECT_STORE_ACCESS_KEY']!,
    secretKey: vars['OBJECT_STORE_SECRET_KEY']!,
    bucket: vars['OBJECT_STORE_BUCKET']!,
    cdnBaseUrl: vars['CDN_BASE_URL'],
    cdnKeyPairId: vars['CDN_KEY_PAIR_ID'],
    cdnPrivateKey: vars['CDN_PRIVATE_KEY'],
  };
}

let _instance: ObjectStore | null = null;

/**
 * Returns a singleton ObjectStore instance.
 * In production, secrets are sourced from AWS Secrets Manager via getSecrets().
 * In development, secrets are read directly from environment variables.
 */
export async function getObjectStore(): Promise<ObjectStore> {
  if (_instance) return _instance;

  let vars: Record<string, string | undefined>;

  if (process.env.NODE_ENV === 'production') {
    // Lazy import to avoid bundling secrets module in dev
    const { getSecrets } = await import('../secrets');
    const secrets = await getSecrets();
    vars = { ...process.env, ...secrets };
  } else {
    vars = process.env as Record<string, string | undefined>;
  }

  const config = validateConfig(vars);

  if (process.env.NODE_ENV === 'production') {
    const { S3Adapter } = await import('./s3Adapter');
    _instance = new S3Adapter(config);
  } else {
    const { SwiftAdapter } = await import('./swiftAdapter');
    _instance = new SwiftAdapter(config);
  }

  return _instance;
}

/**
 * Synchronous factory used in contexts where async is not available.
 * Reads only from process.env (no Secrets Manager).
 * Throws immediately if any required env var is missing.
 */
export function createObjectStoreSync(): ObjectStore {
  const config = validateConfig(process.env as Record<string, string | undefined>);

  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line
    const { S3Adapter } = require('./s3Adapter') as typeof import('./s3Adapter');
    return new S3Adapter(config);
  } else {
    // eslint-disable-next-line
    const { SwiftAdapter } = require('./swiftAdapter') as typeof import('./swiftAdapter');
    return new SwiftAdapter(config);
  }
}

export { validateConfig, REQUIRED_ENV_VARS };
export type { ObjectStore };
