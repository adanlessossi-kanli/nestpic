import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

// Mock server-only so it doesn't throw in test environment
vi.mock('server-only', () => ({}));

// Mock @aws-sdk/s3-request-presigner
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

// Mock @aws-sdk/client-s3
vi.mock('@aws-sdk/client-s3', () => {
  const mockSend = vi.fn();
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'PutObject' })),
    GetObjectCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'GetObject' })),
    DeleteObjectCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'DeleteObject' })),
    HeadObjectCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'HeadObject' })),
    _mockSend: mockSend,
  };
});

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as S3Module from '@aws-sdk/client-s3';
import { SwiftAdapter } from '@/lib/objectStore/swiftAdapter';
import { S3Adapter } from '@/lib/objectStore/s3Adapter';

// Access the shared mock send function
// eslint-disable-next-line
const mockSend = (S3Module as Record<string, unknown>)._mockSend as ReturnType<typeof vi.fn>;
const mockGetSignedUrl = getSignedUrl as ReturnType<typeof vi.fn>;

const SWIFT_CONFIG = {
  endpoint: 'http://localhost:8080',
  accessKey: 'test-access',
  secretKey: 'test-secret',
  bucket: 'nestpic-test',
};

// Real RSA key generated for testing only — not used in production
const TEST_RSA_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAqc9AE02YXKtuxst09jnlr4DNckmSPEpi67VuDr01+SKWh1EO
70njWz/B66YogbEuvHTrDpN5hENxZ6B601SZF9FW8gLG8nZarBB02LSrGs673cZG
DLW5Ja0ldLJUoLfmw9PjO920J7MU1q6OO3J+niupSg6T7ICuowfJ/RtCDodB5tk8
o1h3BM0SpoLPUfxaFGIlma1tkREC3dpk+D+Q8aCKoikACwlMP5KUlolIfbE+wmy0
AwWLnwsGE2rbaTs3SevI9b5GD8tHC8tO2rB+37PJ9XhvxAjIovJ1zk7zyODmzKvc
SF8/YwtJ3fR216lvs6ayl7RfuMFOt61zsdgn3QIDAQABAoIBACOFIXFYPBx4VLf7
M5hUxI2ZWwBC0PbRFY+aGC83l3xpZoTgKQhXU5pRBCKjk1oLosvThh66rQLEa8qi
KEcf7VUs2ivN9mkd5joTSCnTYu4829HYaWs7sQKnTQwzyF2FEl2YqzHo3ogmXt/I
TCK1wLQbzHHcCkfApCcgmDkcVE0+2QgjmGK4usZnlAJGc579eiFlBaX3lDFz6vm0
cr3CkqAPtPtB6sb3FxfKrJfjBwxNwKsZqbYOx+1us3X+gPRgOSZo1wZmjcyLSr2x
sbYqpMEdyfHUEXf67Wh51UhXtb3QhMea/RFJb0v9n4QsBtm3E+DvNT/sR/g8D3Jw
DGZhgNECgYEA0r1ax2Xw/+RjLayyQzBUQ55rqZ+Z/MtmQT+bD1zn1m1mei77qjvQ
UxRS5h4nhuCGzjUdaZtGXJ0tpMZzPI6UV8szlLLP8hsTpKlJTFvMNYQGC+W8O3nD
uiEbEHIFb8k5zAj0+9jFocY5OLRahSLs4cL1EQoG1gs+Be9zvdoI0FECgYEAzkeG
PqFs+88ar0t/EH7NO69/97eN3spmG0tHgpIF56/ZJPM/JlUee515T/C2JXCmc245
mXL0xjG/aPQUJqe5Vi+OG+pGEdQoOtKVEYuF23SgaZ6DYxnMUhh6Hj29sOGy+sX1
p/lYen4SALIYT+TockiStAF53kft5FaaMZH9J80CgYAVMaPyj8cIBTEQQ+D9rtua
nVEYkwuKh+41u67dgatzPjdjLFx1B2TxJgccS4YQI36LOH5Hw6z03X3cp3Spb3Ft
zurWFpGhOKXmFnxfqI/GBgwRoD4pARr1GiU9pynyzxr38SKqPWfK2EOi90hvQU7v
eYrp9scvOZw4Ppe2TTo7sQKBgQCZ968PDoR/S62aTBqyoELmGu/EYYCGW8Js+vqM
ThwUPCAzQVDQdtZC5F6JOZ1rQrMrE4nwrGphiP5bA1wLIkPnPaWv1mSoqBfDGC1m
JCMsk9esHkHpdXcZi+WSrvjojv59yca7sxTEkVc0p7oX4D9UFjFSJIvnSv8Y4T9E
Yrh3vQKBgQCKfB94PuOMqkAJXXlwcOQGvxKXncI1ZDLEygUuQ7L4sfv98O3tceLQ
3hHGwd+gACJwtZUR0+e9MERj09uBIL9MKa5/jttEyMuyoGgDsRBrl3Oki+LrpXEX
wsApVRIfM3ga8FEex2kMh+W/RXdCOA9TTlDM47BO6uY8cCjnvKD8kg==
-----END RSA PRIVATE KEY-----`;

const S3_CONFIG = {
  ...SWIFT_CONFIG,
  cdnBaseUrl: 'https://d1234.cloudfront.net',
  cdnKeyPairId: 'APKAXXX',
  cdnPrivateKey: TEST_RSA_PRIVATE_KEY,
};

// ─── SwiftAdapter ────────────────────────────────────────────────────────────

describe('SwiftAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an S3Client with forcePathStyle and the configured endpoint', () => {
    new SwiftAdapter(SWIFT_CONFIG);
    expect(S3Module.S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: SWIFT_CONFIG.endpoint,
        forcePathStyle: true,
      })
    );
  });

  describe('generatePresignedPutUrl', () => {
    it('returns a dev-upload proxy URL for the given key', async () => {
      const adapter = new SwiftAdapter(SWIFT_CONFIG);

      const url = await adapter.generatePresignedPutUrl(
        'uploads/file.jpg',
        'image/jpeg',
        1024,
        900
      );

      expect(url).toContain('/api/dev-upload/uploads/file.jpg');
    });

    it('includes the key in the URL', async () => {
      const adapter = new SwiftAdapter(SWIFT_CONFIG);

      const url = await adapter.generatePresignedPutUrl('originals/video.mp4', 'video/mp4', 5_000_000, 600);

      expect(url).toContain('originals/video.mp4');
    });
  });

  describe('generateSignedGetUrl', () => {
    it('returns a dev-upload proxy URL from Swift', async () => {
      const adapter = new SwiftAdapter(SWIFT_CONFIG);

      const url = await adapter.generateSignedGetUrl('thumbnails/abc.jpg', 3600);

      expect(url).toContain('/api/dev-upload/thumbnails/abc.jpg');
    });
  });

  describe('deleteObject', () => {
    it('sends a DELETE request to the dev proxy', async () => {
      const adapter = new SwiftAdapter(SWIFT_CONFIG);
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });

      await adapter.deleteObject('uploads/file.jpg');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dev-upload/uploads/file.jpg'),
        { method: 'DELETE' }
      );
    });
  });

  describe('headObject', () => {
    it('returns contentLength and contentType from the HeadObject response', async () => {
      const adapter = new SwiftAdapter(SWIFT_CONFIG);
      // Mock fetch to return a successful HEAD response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-length': '2048', 'content-type': 'image/png' }),
      });

      const result = await adapter.headObject('uploads/photo.png');

      expect(result).toEqual({ contentLength: 2048, contentType: 'image/png' });
    });

    it('defaults to 0 and application/octet-stream when response fields are absent', async () => {
      const adapter = new SwiftAdapter(SWIFT_CONFIG);
      // Mock fetch to return a successful HEAD response with no content headers
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({}),
      });

      const result = await adapter.headObject('uploads/unknown');

      expect(result).toEqual({ contentLength: 0, contentType: 'application/octet-stream' });
    });
  });
});

// ─── S3Adapter ───────────────────────────────────────────────────────────────

describe('S3Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws if CDN config is missing', () => {
    expect(
      () => new S3Adapter({ ...SWIFT_CONFIG }) // no CDN fields
    ).toThrow(/CDN_BASE_URL/);
  });

  describe('generatePresignedPutUrl', () => {
    it('calls getSignedUrl with PutObjectCommand including ContentType and ContentLength', async () => {
      const adapter = new S3Adapter(S3_CONFIG);
      mockGetSignedUrl.mockResolvedValue('https://s3/presigned-put');

      const url = await adapter.generatePresignedPutUrl(
        'uploads/video.mp4',
        'video/mp4',
        10_000_000,
        900
      );

      expect(url).toBe('https://s3/presigned-put');
      expect(S3Module.PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: S3_CONFIG.bucket,
          Key: 'uploads/video.mp4',
          ContentType: 'video/mp4',
          ContentLength: 10_000_000,
        })
      );
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 900 }
      );
    });
  });

  describe('generateSignedGetUrl', () => {
    it('returns a CloudFront signed URL containing the key and Key-Pair-Id', async () => {
      const adapter = new S3Adapter(S3_CONFIG);

      const url = await adapter.generateSignedGetUrl('thumbnails/img.jpg', 3600);

      expect(url).toContain('thumbnails/img.jpg');
      expect(url).toContain(`Key-Pair-Id=${S3_CONFIG.cdnKeyPairId}`);
      expect(url).toContain('Policy=');
      expect(url).toContain('Signature=');
    });

    it('scopes the signed URL to the specific object key (Property 24)', async () => {
      const adapter = new S3Adapter(S3_CONFIG);

      const url1 = await adapter.generateSignedGetUrl('thumbnails/a.jpg', 3600);
      const url2 = await adapter.generateSignedGetUrl('thumbnails/b.jpg', 3600);

      expect(url1).toContain('thumbnails/a.jpg');
      expect(url2).toContain('thumbnails/b.jpg');
      expect(url1).not.toContain('thumbnails/b.jpg');
      expect(url2).not.toContain('thumbnails/a.jpg');
    });

    it('strips trailing slash from cdnBaseUrl before building the URL', async () => {
      const adapter = new S3Adapter({
        ...S3_CONFIG,
        cdnBaseUrl: 'https://d1234.cloudfront.net/',
      });

      const url = await adapter.generateSignedGetUrl('media/file.jpg', 3600);

      // Should not have double slash
      expect(url).not.toContain('//media');
      expect(url).toContain('https://d1234.cloudfront.net/media/file.jpg');
    });
  });

  describe('deleteObject', () => {
    it('sends a DeleteObjectCommand with the correct key', async () => {
      const adapter = new S3Adapter(S3_CONFIG);
      mockSend.mockResolvedValue({});

      await adapter.deleteObject('uploads/file.jpg');

      expect(S3Module.DeleteObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: S3_CONFIG.bucket,
          Key: 'uploads/file.jpg',
        })
      );
    });
  });

  describe('headObject', () => {
    it('returns contentLength and contentType from the HeadObject response', async () => {
      const adapter = new S3Adapter(S3_CONFIG);
      mockSend.mockResolvedValue({ ContentLength: 512, ContentType: 'image/webp' });

      const result = await adapter.headObject('uploads/img.webp');

      expect(result).toEqual({ contentLength: 512, contentType: 'image/webp' });
    });
  });
});
