import crypto from 'crypto';
import {
  S3Client,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStore } from './types';
import type { ObjectStoreConfig } from './index';

export class S3Adapter implements ObjectStore {
  private client: S3Client;
  private bucket: string;
  private cdnBaseUrl: string;
  private cdnKeyPairId: string;
  private cdnPrivateKey: string;

  constructor(config: ObjectStoreConfig) {
    if (!config.cdnBaseUrl || !config.cdnKeyPairId || !config.cdnPrivateKey) {
      throw new Error(
        'S3Adapter requires CDN_BASE_URL, CDN_KEY_PAIR_ID, and CDN_PRIVATE_KEY ' +
          'for generating CloudFront signed URLs in production.'
      );
    }

    this.client = new S3Client({
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    });

    this.bucket = config.bucket;
    this.cdnBaseUrl = config.cdnBaseUrl.replace(/\/$/, '');
    this.cdnKeyPairId = config.cdnKeyPairId;
    this.cdnPrivateKey = config.cdnPrivateKey.replace(/\\n/g, '\n');
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
    const resourceUrl = `${this.cdnBaseUrl}/${key}`;
    const expiresEpoch = Math.floor(Date.now() / 1000) + expiresIn;

    // CloudFront canned policy signed URL
    const policy = JSON.stringify({
      Statement: [
        {
          Resource: resourceUrl,
          Condition: { DateLessThan: { 'AWS:EpochTime': expiresEpoch } },
        },
      ],
    });

    const sign = crypto.createSign('RSA-SHA1');
    sign.update(policy);
    const signature = sign
      .sign(this.cdnPrivateKey)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/=/g, '_')
      .replace(/\//g, '~');

    const encodedPolicy = Buffer.from(policy)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/=/g, '_')
      .replace(/\//g, '~');

    return (
      `${resourceUrl}` +
      `?Policy=${encodedPolicy}` +
      `&Signature=${signature}` +
      `&Key-Pair-Id=${this.cdnKeyPairId}`
    );
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
