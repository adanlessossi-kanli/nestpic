import {
  S3Client,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStore } from './types';
import type { ObjectStoreConfig } from './index';

/**
 * OpenStack Swift adapter using the S3-compatible API.
 * Reuses the AWS SDK S3 client pointed at the Swift endpoint.
 * Signed GET URLs are plain presigned S3 GET URLs (no CloudFront in dev).
 */
export class SwiftAdapter implements ObjectStore {
  private client: S3Client;
  private bucket: string;

  constructor(config: ObjectStoreConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: 'us-east-1', // Swift requires a region value; the actual value is ignored
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true, // Required for Swift S3-compatible API
    });

    this.bucket = config.bucket;
  }

  async generatePresignedPutUrl(
    key: string,
    contentType: string,
    contentLength: number,
    expiresIn: number
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  async generateSignedGetUrl(key: string, expiresIn: number): Promise<string> {
    // In local dev, use a presigned S3-compatible GET URL directly from Swift
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async headObject(key: string): Promise<{ contentLength: number; contentType: string }> {
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key })
    );

    return {
      contentLength: response.ContentLength ?? 0,
      contentType: response.ContentType ?? 'application/octet-stream',
    };
  }
}
