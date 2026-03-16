import {
  S3Client,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { ObjectStore } from './types';
import type { ObjectStoreConfig } from './index';

/**
 * OpenStack Swift adapter for local development.
 * Uses a local dev-upload proxy endpoint for presigned URLs to avoid
 * CORS and S3-compatibility issues with the Swift container.
 * Uses the S3 client for delete and headObject operations.
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
    // Use a local proxy endpoint to avoid CORS/auth issues with Swift container
    return `${this.baseUrl}/api/dev-upload/${key}`;
  }

  async generateSignedGetUrl(key: string, _expiresIn: number): Promise<string> {
    // Use a local proxy endpoint for GET URLs
    return `${this.baseUrl}/api/dev-upload/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    // In development, delete from the local proxy store
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    await fetch(`${baseUrl}/api/dev-upload/${key}`, { method: 'DELETE' });
  }

  async headObject(key: string): Promise<{ contentLength: number; contentType: string }> {
    // Check the local proxy store first
    const res = await fetch(`${this.baseUrl}/api/dev-upload/${key}`, { method: 'HEAD' });
    if (res.ok) {
      return {
        contentLength: parseInt(res.headers.get('content-length') ?? '0', 10),
        contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      };
    }
    // Fall back to S3 client
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key })
    );
    return {
      contentLength: response.ContentLength ?? 0,
      contentType: response.ContentType ?? 'application/octet-stream',
    };
  }
}
