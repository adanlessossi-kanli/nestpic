import 'server-only';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

export type AppSecrets = {
  OBJECT_STORE_ENDPOINT?: string;
  OBJECT_STORE_ACCESS_KEY?: string;
  OBJECT_STORE_SECRET_KEY?: string;
  OBJECT_STORE_BUCKET?: string;
  DATABASE_URL?: string;
  SESSION_SECRET?: string;
  CDN_BASE_URL?: string;
  CDN_KEY_PAIR_ID?: string;
  CDN_PRIVATE_KEY?: string;
};

let _cachedSecrets: AppSecrets | null = null;

/**
 * Fetches production secrets from AWS Secrets Manager and caches the result.
 * Falls back to an empty object in non-production environments so callers
 * can safely merge with process.env.
 *
 * The secret is expected to be a JSON string containing key/value pairs
 * matching the AppSecrets type.
 */
export async function getSecrets(): Promise<AppSecrets> {
  if (_cachedSecrets !== null) return _cachedSecrets;

  if (process.env.NODE_ENV !== 'production') {
    _cachedSecrets = {};
    return _cachedSecrets;
  }

  const secretArn = process.env.SECRETS_MANAGER_SECRET_ARN;
  if (!secretArn) {
    throw new Error(
      'SECRETS_MANAGER_SECRET_ARN environment variable is required in production. ' +
        'Set it to the ARN of your Secrets Manager secret.'
    );
  }

  const client = new SecretsManagerClient({});

  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error(
      `Secrets Manager secret "${secretArn}" returned no SecretString. ` +
        'Ensure the secret is a JSON string, not a binary secret.'
    );
  }

  try {
    _cachedSecrets = JSON.parse(response.SecretString) as AppSecrets;
  } catch {
    throw new Error(
      `Failed to parse Secrets Manager secret "${secretArn}" as JSON. ` +
        'Ensure the secret value is a valid JSON object.'
    );
  }

  return _cachedSecrets;
}

/**
 * Clears the secrets cache. Useful in tests.
 */
export function clearSecretsCache(): void {
  _cachedSecrets = null;
}
