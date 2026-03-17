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

  // In dev, read directly from the in-process store to avoid HTTP round-trips
  if ('getObjectBuffer' in objectStore) {
    const inputBuffer = (objectStore as { getObjectBuffer(k: string): Buffer }).getObjectBuffer(s3Key);
    return sharp(inputBuffer)
      .resize(THUMBNAIL_MAX_PX, THUMBNAIL_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg()
      .toBuffer();
  }

  const signedUrl = await objectStore.generateSignedGetUrl(s3Key, PRESIGN_EXPIRES_IN);
  const response = await fetch(signedUrl);
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
  let inputFile: string | null = null;

  try {
    if ('getObjectBuffer' in objectStore) {
      // Dev fast path: read directly from in-process store, bypass HTTP layer
      const videoBuffer = (objectStore as { getObjectBuffer(k: string): Buffer }).getObjectBuffer(s3Key);
      inputFile = path.join(tmpDir, `nestpic-input-${crypto.randomUUID()}.tmp`);
      fs.writeFileSync(inputFile, videoBuffer);
      await extractFirstFrame(inputFile, frameFile);
    } else {
      // Production path: use signed URL
      const signedUrl = await objectStore.generateSignedGetUrl(s3Key, PRESIGN_EXPIRES_IN);
      await extractFirstFrame(signedUrl, frameFile);
    }

    return await sharp(frameFile)
      .resize(THUMBNAIL_MAX_PX, THUMBNAIL_MAX_PX, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg()
      .toBuffer();
  } finally {
    if (inputFile) {
      try { fs.unlinkSync(inputFile); } catch { /* best-effort */ }
    }
    try { fs.unlinkSync(frameFile); } catch { /* best-effort */ }
  }
}

function extractFirstFrame(inputUrl: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputUrl)
      .outputOptions(['-vframes 1', '-q:v 2'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

async function uploadThumbnail(thumbnailKey: string, jpegBuffer: Buffer): Promise<void> {
  const objectStore = await getObjectStore();

  // In dev, write directly to the in-process store
  if ('putObjectBuffer' in objectStore) {
    (objectStore as { putObjectBuffer(k: string, d: Buffer, ct: string): void })
      .putObjectBuffer(thumbnailKey, jpegBuffer, 'image/jpeg');
    return;
  }

  const putUrl = await objectStore.generatePresignedPutUrl(
    thumbnailKey,
    'image/jpeg',
    jpegBuffer.byteLength,
    PRESIGN_EXPIRES_IN
  );

  const response = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(jpegBuffer.byteLength),
    },
    body: jpegBuffer.buffer.slice(jpegBuffer.byteOffset, jpegBuffer.byteOffset + jpegBuffer.byteLength) as ArrayBuffer,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload thumbnail: ${response.status} ${response.statusText}`);
  }
}
