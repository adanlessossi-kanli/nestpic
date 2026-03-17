# Bugfix Requirements Document

## Introduction

Thumbnails generated after media upload are not displayed in the browser. After a user uploads a photo or video, the media grid shows a blank grey placeholder instead of the thumbnail image. This affects all media items in the feed and album views.

Three distinct issues are covered by this document:

1. Dev environment module-instance mismatch: the in-memory object store (`global.__devStore`) is written by the thumbnail worker in one Next.js module context but read by the `/api/dev-upload/[...key]` route handler in a different context, returning 404 for every thumbnail request.

2. Production corrupt JPEG: `uploadThumbnail` constructs the PUT body as `jpegBuffer.buffer.slice(byteOffset, byteOffset + byteLength)`. When the `Buffer` was allocated from a Node.js pool, `byteOffset` may be non-zero, causing garbage bytes to be prepended to the JPEG data in S3.

3. Video thumbnail generation in dev: `processVideo` fetches the source video via a signed URL (`/api/dev-upload/{key}`) so that ffmpeg can read it over HTTP. In dev this URL resolves to the same `__devStore` route handler affected by issue 1, so ffmpeg receives a 404 and frame extraction fails. Unlike `processImage`, `processVideo` has no direct `getObjectBuffer` fast path to bypass the HTTP layer. The accepted upload MIME types include `video/mp4`, `video/quicktime`, and `video/x-msvideo`, so video uploads are expected to produce thumbnails.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a media item has been uploaded and its thumbnail has been generated and stored THEN the system returns HTTP 404 for the thumbnail GET request in the dev environment, because the in-memory store instance read by the route handler differs from the one written by the thumbnail worker.

1.2 WHEN the thumbnail worker writes a thumbnail via `putObjectBuffer` in dev THEN the system stores it in the `global.__devStore` of the instrumentation module context, which is not accessible to the `dev-upload` route handler running in a different module instance.

1.3 WHEN `uploadThumbnail` constructs the PUT request body in production THEN the system passes `jpegBuffer.buffer.slice(byteOffset, byteOffset + byteLength)` as the fetch body, which may include unintended bytes when the Buffer shares a pooled ArrayBuffer with a non-zero `byteOffset`, resulting in a corrupt thumbnail stored in S3.

1.4 WHEN the feed API evaluates `row.thumbnail_key` for a media item whose thumbnail was stored with an incorrect key prefix THEN the system skips URL generation and returns `thumbnailUrl: null`, so the browser renders a blank placeholder.

1.5 WHEN a video file (`video/mp4`, `video/quicktime`, or `video/x-msvideo`) is uploaded in the dev environment and the thumbnail worker attempts to extract the first frame THEN the system fails to generate a thumbnail because `processVideo` fetches the source video via a signed HTTP URL (`/api/dev-upload/{key}`) that resolves to the same `__devStore` route handler affected by the module-instance mismatch, causing ffmpeg to receive a 404 and frame extraction to fail.

1.6 WHEN `processVideo` is called in dev THEN the system does not use the direct `getObjectBuffer` fast path (unlike `processImage`), so it always routes through the HTTP layer and inherits the module-instance mismatch failure.

1.7 WHEN `processVideo` creates a temporary file for ffmpeg frame extraction THEN the system does not guarantee cleanup if the process exits unexpectedly or is killed, leaving orphaned temp files in `os.tmpdir()`.

1.8 WHEN thumbnail generation fails THEN the system logs the raw error object which may include internal file paths, stack traces, or object store configuration details that should not be exposed in logs accessible to non-privileged users.

1.9 WHEN `processVideo` generates a temporary filename using only `Date.now()` THEN the system may produce colliding filenames under concurrent thumbnail processing, causing one worker to overwrite or delete another worker's temp file.

### Expected Behavior (Correct)

2.1 WHEN a media item has been uploaded and its thumbnail has been generated THEN the system SHALL serve the thumbnail image successfully (HTTP 200 with correct JPEG content) from `/api/dev-upload/thumbnails/{mediaId}.jpg` in the dev environment.

2.2 WHEN the thumbnail worker writes a thumbnail via `putObjectBuffer` in dev THEN the system SHALL store it in the same `global.__devStore` instance that the `dev-upload` route handler reads from, ensuring the data is retrievable across module contexts.

2.3 WHEN `uploadThumbnail` constructs the PUT request body in production THEN the system SHALL pass only the exact bytes of the JPEG buffer (using `Buffer.from(jpegBuffer)` or equivalent) so that the stored thumbnail is a valid, uncorrupted JPEG file.

2.4 WHEN the feed API evaluates `row.thumbnail_key` for a media item with a valid `thumbnails/` prefixed key THEN the system SHALL generate and return a signed URL so the browser can display the thumbnail.

2.5 WHEN a video file (`video/mp4`, `video/quicktime`, or `video/x-msvideo`) is uploaded in the dev environment and the thumbnail worker processes it THEN the system SHALL successfully extract the first frame and generate a JPEG thumbnail, by reading the source video directly from the in-process store via `getObjectBuffer` rather than via the HTTP layer.

2.6 WHEN `processVideo` is called in dev and the object store exposes `getObjectBuffer` THEN the system SHALL write the video to a temporary file from the in-memory buffer and pass that file path to ffmpeg, bypassing the HTTP signed-URL path entirely.

2.7 WHEN `processVideo` creates a temporary file for ffmpeg input or frame output THEN the system SHALL use `os.tmpdir()` as the base directory and generate a unique filename incorporating a cryptographically random component (e.g. `crypto.randomUUID()`) to prevent collisions under concurrent processing.

2.8 WHEN `processVideo` finishes processing (whether successfully or with an error) THEN the system SHALL delete all temporary files it created in the `finally` block, ensuring no orphaned files remain in `os.tmpdir()`.

2.9 WHEN the process receives `SIGTERM` or `SIGINT` while a thumbnail is being processed THEN the system SHALL attempt to clean up any in-progress temporary files before exiting, to avoid accumulating stale files across restarts.

2.10 WHEN thumbnail generation fails for a media item THEN the system SHALL log a structured error message containing only the `mediaId`, a sanitized error message (no internal paths or stack traces), and the failure reason, without leaking object store configuration or file system layout.

2.11 WHEN thumbnail generation fails for a media item THEN the system SHALL leave the media record in its current state (active, `thumbnail_key IS NULL`) so the item remains accessible and the worker can retry on the next poll cycle, rather than deleting or invalidating the record.

2.12 WHEN an error response is returned from any thumbnail-related API endpoint THEN the system SHALL return only a generic client-safe message (e.g. `"Thumbnail generation failed"`) and SHALL NOT include internal error details, file paths, or stack traces in the response body.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a media item does not yet have a thumbnail (thumbnail_key IS NULL) THEN the system SHALL CONTINUE TO render a grey placeholder in the media grid without errors.

3.2 WHEN a user uploads a new media file THEN the system SHALL CONTINUE TO create a pending media record and return a presigned upload URL without modification to the upload flow.

3.3 WHEN a media item is confirmed as active THEN the system SHALL CONTINUE TO activate the record and queue it for thumbnail processing by the local worker.

3.4 WHEN a media item is deleted THEN the system SHALL CONTINUE TO delete both the original object and the thumbnail object (if present) from the object store.

3.5 WHEN the feed API processes a media item with a thumbnail_key that does not start with `thumbnails/` THEN the system SHALL CONTINUE TO return `thumbnailUrl: null` for that item (regression guard for the migration-002 scenario).

3.6 WHEN the application runs in production THEN the system SHALL CONTINUE TO use the S3Adapter and Lambda thumbnail handler without falling back to the dev in-memory store.

3.7 WHEN an image file is uploaded and processed by the thumbnail worker THEN the system SHALL CONTINUE TO generate a JPEG thumbnail via the existing `processImage` path (sharp resize) without any change in behavior.

3.8 WHEN a video file is uploaded and processed in production THEN the system SHALL CONTINUE TO extract the first frame via ffmpeg using the signed GET URL from S3, resize it with sharp, and upload the resulting JPEG thumbnail via the presigned PUT URL.

3.9 WHEN thumbnail generation succeeds THEN the system SHALL CONTINUE TO update `thumbnail_key` in the media table and serve the thumbnail on subsequent requests.

3.10 WHEN the local worker polls for pending thumbnails and encounters a `NoSuchKey` error THEN the system SHALL CONTINUE TO delete the orphaned media record and log a warning, as before.
