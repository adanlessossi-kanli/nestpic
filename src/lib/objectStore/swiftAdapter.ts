import {
  S3Client,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { ObjectStore } from './types';
import type { ObjectStoreConfig } from './index';
import { getDevStore } from '@/app/api/dev-upload/store';

/**
 * OpenStack Swift adapter for local development.
 * Reads/writes directly from the in-process dev store to avoid HTTP round-trips
 * and CORS/auth issues with the Swift container.
 */
export class SwiftAdapter implements ObjectStore {
  private client: S3Client;
  private bucket: string;
  private baseUrl: string;

  constructor(config: ObjectStoreConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true,
    });

    this.bucket = config.bucket;
    this.baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  }

  async generatePresignedPutUrl(
    key: string,
    _contentType: string,
    _contentLength: number,
    _expiresIn: number
  ): Promise<string> {
    return `${this.baseUrl}/api/dev-upload/${key}`;
  }

  async generateSignedGetUrl(key: string, _expiresIn: number): Promise<string> {
    return `${this.baseUrl}/api/dev-upload/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    getDevStore().delete(key);
  }

  async headObject(key: string): Promise<{ contentLength: number; contentType: string }> {
    const entry = getDevStore().get(key);
    if (!entry) {
      throw Object.assign(new Error(`Object not found: ${key}`), { code: 'NoSuchKey' });
    }
    return { contentLength: entry.data.length, contentType: entry.contentType };
  }

  // Direct in-process read used by the thumbnail processor
  getObjectBuffer(key: string): Buffer {
    const entry = getDevStore().get(key);
    if (!entry) {
      throw Object.assign(new Error(`Object not found: ${key}`), { code: 'NoSuchKey' });
    }
    return entry.data;
  }

  // Direct in-process write used by the thumbnail processor
  putObjectBuffer(key: string, data: Buffer, contentType: string): void {
    getDevStore().set(key, { data, contentType });
  }
}
