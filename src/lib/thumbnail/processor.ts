import 'server-only';
import os from 'os';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { getObjectStore } from '../objectStore/index';
import { query } from '../db';

const THUMBNAIL_MAX_PX = 400;
const PRESIGN_EXPIRES_IN = 900; // 15 minutes

/**
 * Processes a media file and generates a JPEG thumbnail stored at thumbnails/{mediaId}.jpg.
 * Supports image/* (resized via sharp) and video/* (first frame extracted via ffmpeg, then resized).
 * Updates the thumbnail_key column in the media table after writing.
 *
 * In dev, all reads and writes go through HTTP to the dev-upload route handler,
 * which is the single source of truth for the in-memory store. This avoids
 * cross-thread global.__devStore mismatch (instrumentation vs route handler threads).
 */
export async function processMedia(
  mediaId: string,
  s3Key: string,
  contentType: string
): Promise<void> {
  const thumbnailKey = `thumbnails/${mediaId}.jpg`;

  let jpegBuffer: Buffer;

  if (contentType.startsWith('image/')) {
    jpegBuffer = await processImage(s3Key);
  } else if (contentType.startsWith('video/')) {
    jpegBuffer = await processVideo(s3Key);
  } else {
    throw new Error(`Unsupported content type for thumbnail generation: ${contentType}`);
  }

  await uploadThumbnail(thumbnailKey, jpegBuffer);

  await query('UPDATE media SET thumbnail_key = $1 WHERE id = $2', [thumbnailKey, mediaId]);
}

async function processImage(s3Key: string): Promise<Buffer> {
  const objectStore = await getObjectStore();
  const signedUrl = await objectStore.generateSignedGetUrl(s3Key, PRESIGN_EXPIRES_IN);
  console.log(`[processor] GET ${signedUrl}`);
  const response = await fetch(signedUrl);
  console.log(`[processor] GET status: ${response.status}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch image from object store: ${response.status}`);
  }
  const inputBuffer = Buffer.from(await response.arrayBuffer());
  return sharp(inputBuffer)
    .resize(THUMBNAIL_MAX_PX, THUMBNAIL_MAX_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg()
    .toBuffer();
}

async function processVideo(s3Key: string): Promise<Buffer> {
  const objectStore = await getObjectStore();
  const tmpDir = os.tmpdir();
  const frameFile = path.join(tmpDir, `nestpic-frame-${crypto.randomUUID()}.jpg`);
  const inputFile = path.join(tmpDir, `nestpic-input-${crypto.randomUUID()}.tmp`);

  try {
    // Fetch the source video via HTTP (works in both dev and prod)
    const signedUrl = await objectStore.generateSignedGetUrl(s3Key, PRESIGN_EXPIRES_IN);
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch video from object store: ${response.status}`);
    }
    fs.writeFileSync(inputFile, Buffer.from(await response.arrayBuffer()));
    await extractFirstFrame(inputFile, frameFile);

    return await sharp(frameFile)
      .resize(THUMBNAIL_MAX_PX, THUMBNAIL_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg()
      .toBuffer();
  } finally {
    try { fs.unlinkSync(inputFile); } catch { /* best-effort */ }
    try { fs.unlinkSync(frameFile); } catch { /* best-effort */ }
  }
}

function extractFirstFrame(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-vframes 1', '-q:v 2'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

async function uploadThumbnail(thumbnailKey: string, jpegBuffer: Buffer): Promise<void> {
  const objectStore = await getObjectStore();

  const putUrl = await objectStore.generatePresignedPutUrl(
    thumbnailKey,
    'image/jpeg',
    jpegBuffer.byteLength,
    PRESIGN_EXPIRES_IN
  );

  // Use a fresh Uint8Array copy to avoid pooled-buffer byteOffset issues
  const body = new Uint8Array(jpegBuffer.buffer, jpegBuffer.byteOffset, jpegBuffer.byteLength);

  const response = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/jpeg',
    },
    // @ts-expect-error Node.js fetch accepts Uint8Array as body
    body,
    duplex: 'half',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to upload thumbnail: ${response.status} ${response.statusText} ${text}`);
  }
}
