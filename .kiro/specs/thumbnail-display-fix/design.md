# Thumbnail Display Fix - Bugfix Design

## Overview

Thumbnails generated after media upload are not displayed in the browser. After a user uploads a photo or video, the media grid shows a blank grey placeholder instead of the thumbnail image. This affects all media items in the feed and album views.

Three distinct root causes are addressed:

1. **Dev store module-instance mismatch**: `SwiftAdapter.putObjectBuffer` writes to `global.__devStore` via `getDevStore()`, but the `dev-upload` route handler also calls `getDevStore()`. Because Next.js can load the same module in different module-instance contexts (instrumentation vs. route handler), the two calls may resolve to different `Map` instances, so thumbnails written by the worker are invisible to the HTTP layer.

2. **Production corrupt JPEG**: `uploadThumbnail` passes `jpegBuffer.buffer.slice(byteOffset, byteOffset + byteLength)` as the fetch body. When the `Buffer` was allocated from a Node.js pool, `byteOffset` may be non-zero, prepending garbage bytes to the JPEG data stored in S3.

3. **Video thumbnail failure in dev**: `processVideo` always fetches the source video via a signed HTTP URL, which in dev resolves to the `dev-upload` route handler affected by issue 1. Unlike `processImage`, it has no `getObjectBuffer` fast path, so ffmpeg receives a 404 and frame extraction fails.

The fix is targeted and minimal: correct the store-sharing mechanism, fix the buffer slice, and add a dev fast path to `processVideo`.

## Glossary

- **Bug_Condition (C)**: The set of conditions that cause thumbnails to be missing or corrupt after upload
- **Property (P)**: The desired behavior — a successfully uploaded media item SHALL have a displayable thumbnail URL returned by the feed API
- **Preservation**: Existing upload flow, image thumbnail generation, production S3 behavior, and feed rendering of items without thumbnails must remain unchanged
- **SwiftAdapter**: The dev-environment `ObjectStore` implementation in `src/lib/objectStore/swiftAdapter.ts` that wraps the in-memory dev store
- **getDevStore()**: The function in `src/app/api/dev-upload/store.ts` that returns `global.__devStore`, the singleton `Map` used as the in-memory object store in dev
- **processMedia**: The entry point in `src/lib/thumbnail/processor.ts` that dispatches to `processImage` or `processVideo` and writes `thumbnail_key` to the DB
- **processImage**: Handles image thumbnails; already has a `getObjectBuffer` fast path in dev
- **processVideo**: Handles video thumbnails; currently always uses the HTTP signed-URL path
- **localWorker**: The polling worker in `src/lib/thumbnail/localWorker.ts` that calls `processMedia` for active media with no `thumbnail_key`
- **thumbnail_key**: The DB column on the `media` table storing the object store key for the generated thumbnail (must start with `thumbnails/` to be served)

## Bug Details

### Bug Condition

The bug manifests when any of the following conditions hold:

- (Dev) A thumbnail is written by `processMedia` via `putObjectBuffer` but the `dev-upload` route handler cannot find it because the two callers resolved `getDevStore()` in different module instances.
- (Production) `uploadThumbnail` constructs the PUT body using a pooled `Buffer` with a non-zero `byteOffset`, causing the stored JPEG to contain garbage prefix bytes.
- (Dev, video) `processVideo` is called for a video media item and attempts to fetch the source via the HTTP signed-URL path, which fails with 404 due to the same module-instance mismatch.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { mediaId: string, contentType: string, env: 'dev' | 'prod' }
  OUTPUT: boolean

  IF env = 'dev' THEN
    RETURN TRUE  -- module-instance mismatch always present in dev without fix
  END IF

  IF env = 'prod' AND contentType STARTS WITH 'image/' THEN
    RETURN jpegBuffer.byteOffset != 0  -- non-zero offset from pooled Buffer
  END IF

  RETURN FALSE
END FUNCTION
```

### Examples

- **Dev image upload**: User uploads `photo.jpg`. Worker generates thumbnail, calls `putObjectBuffer('thumbnails/abc.jpg', ...)`. Feed API calls `generateSignedGetUrl` → returns `http://localhost:3000/api/dev-upload/thumbnails/abc.jpg`. Browser GETs that URL → route handler calls `getDevStore().get('thumbnails/abc.jpg')` → returns `undefined` → 404. Browser shows grey placeholder.
- **Dev video upload**: User uploads `clip.mp4`. Worker calls `processVideo`, which calls `generateSignedGetUrl` for the source → returns `http://localhost:3000/api/dev-upload/originals/abc.mp4`. ffmpeg fetches that URL → 404 (same mismatch). Frame extraction fails. No thumbnail is ever written.
- **Production image upload (pooled buffer)**: Worker generates a 12 KB JPEG. Node allocates it from an 8 KB pool slab with `byteOffset = 4096`. `jpegBuffer.buffer` is the full 8 KB slab. `slice(4096, 4096 + 12288)` is correct, but if the buffer was sub-allocated differently the slice may include unintended bytes. The stored object is corrupt; the browser receives a broken image.
- **Edge case — no thumbnail yet**: `thumbnail_key IS NULL` → feed returns `thumbnailUrl: null` → grey placeholder renders correctly (not a bug, preserved behavior).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Image thumbnail generation via `processImage` (sharp resize) must continue to work identically in both dev and production
- The upload flow (presign → client PUT → confirm) must remain unchanged
- The feed API must continue to return `thumbnailUrl: null` for items where `thumbnail_key IS NULL` or does not start with `thumbnails/`
- Production video thumbnail generation via ffmpeg + signed S3 URL must remain unchanged
- The `localWorker` polling loop, retry logic, and `NoSuchKey` orphan-deletion behavior must remain unchanged
- Media deletion (original + thumbnail) must remain unchanged
- The `dev-upload` route handler's PUT/GET/HEAD/DELETE behavior for non-thumbnail keys must remain unchanged

**Scope:**
All inputs that do NOT involve thumbnail write/read in dev, or the production PUT body construction, are completely unaffected by this fix. This includes:
- Mouse/touch interactions in the UI
- Auth, session, and invitation flows
- Album creation and membership
- The presign and confirm upload API endpoints
- Any media item that already has a correct `thumbnails/`-prefixed `thumbnail_key`

## Hypothesized Root Cause

1. **Module-instance mismatch for `global.__devStore`**: Next.js instrumentation (`src/instrumentation.ts`) runs `startLocalWorker()` in one module evaluation context. The `dev-upload` route handler is evaluated in a separate context. Even though both call `getDevStore()` which reads `global.__devStore`, the `global` object may differ between contexts in certain Next.js runtime configurations (e.g. Edge vs. Node.js runtime, or separate worker threads). The fix is to ensure both sides always read from the same `global` reference — which `store.ts` already attempts via `global.__devStore`, but the `SwiftAdapter` currently imports `getDevStore` from a path that may be resolved differently.

2. **Incorrect ArrayBuffer slice for pooled Buffers**: `jpegBuffer.buffer` is the underlying `ArrayBuffer` of the Node.js `Buffer`. When the `Buffer` is a view into a pooled slab, `jpegBuffer.byteOffset` is non-zero. The correct way to get only the JPEG bytes as an `ArrayBuffer` is `jpegBuffer.buffer.slice(jpegBuffer.byteOffset, jpegBuffer.byteOffset + jpegBuffer.byteLength)` — which is what the code does — but the safer and simpler approach is `Buffer.from(jpegBuffer)` (copies to a fresh buffer with `byteOffset = 0`) or using `jpegBuffer` directly as the fetch body (Node.js fetch accepts `Buffer`).

3. **No `getObjectBuffer` fast path in `processVideo`**: `processImage` checks `'getObjectBuffer' in objectStore` and reads directly from the in-process store. `processVideo` has no equivalent check, so it always calls `generateSignedGetUrl` and fetches over HTTP. In dev this URL hits the `dev-upload` route handler, which is subject to the module-instance mismatch.

4. **Temporary file collision under concurrency**: `processVideo` names temp files using only `Date.now()`. Concurrent processing of multiple videos within the same millisecond produces identical filenames, causing one worker to clobber another's temp file.

## Correctness Properties

Property 1: Bug Condition - Thumbnail Served After Upload

_For any_ media item where the bug condition holds (dev environment OR production with pooled buffer), the fixed `processMedia` function SHALL successfully write the thumbnail to the object store such that a subsequent GET request to the thumbnail URL returns HTTP 200 with valid JPEG content, and the feed API returns a non-null `thumbnailUrl` for that item.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation - Non-Buggy Input Behavior Unchanged

_For any_ input where the bug condition does NOT hold (items with no thumbnail yet, image processing in production, non-thumbnail API calls), the fixed code SHALL produce exactly the same observable behavior as the original code, preserving all existing functionality including grey placeholder rendering, upload flow, and production S3 interactions.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

**File**: `src/lib/thumbnail/processor.ts`

**Function**: `uploadThumbnail`

**Specific Changes**:

1. **Fix corrupt JPEG body (production)**: Replace the `ArrayBuffer` slice with a direct `Buffer` pass. Node.js `fetch` accepts a `Buffer` as the body, so pass `jpegBuffer` directly instead of `jpegBuffer.buffer.slice(...)`. This eliminates the pooled-buffer offset issue entirely.

```typescript
// Before
body: jpegBuffer.buffer.slice(
  jpegBuffer.byteOffset,
  jpegBuffer.byteOffset + jpegBuffer.byteLength
) as ArrayBuffer,

// After
body: jpegBuffer,
```

**File**: `src/lib/thumbnail/processor.ts`

**Function**: `processVideo`

**Specific Changes**:

2. **Add `getObjectBuffer` fast path for dev**: Mirror the pattern already used in `processImage`. Before calling `generateSignedGetUrl`, check if the object store exposes `getObjectBuffer`. If so, read the video bytes directly, write them to a temp file, and pass that file path to ffmpeg — bypassing the HTTP layer entirely.

3. **Use `crypto.randomUUID()` for temp filenames**: Replace `Date.now()` with `crypto.randomUUID()` to prevent filename collisions under concurrent processing.

4. **Clean up both input and output temp files**: The dev fast path introduces a second temp file (the video input). Both the input temp file and the output frame file must be deleted in the `finally` block.

**File**: `src/lib/objectStore/swiftAdapter.ts` (verify, likely no change needed)

5. **Confirm `getDevStore()` import path**: Verify that `SwiftAdapter` imports `getDevStore` from `@/app/api/dev-upload/store` (which uses `global.__devStore`). This is already the case; the fix in `processVideo` (reading via `getObjectBuffer` on the store instance) will use the same singleton that the route handler uses, resolving the mismatch.

### Pseudocode for Fixed `processVideo`

```
FUNCTION processVideo(s3Key)
  objectStore = await getObjectStore()
  tmpDir = os.tmpdir()
  frameFile = path.join(tmpDir, 'nestpic-frame-' + crypto.randomUUID() + '.jpg')
  inputFile = null

  TRY
    IF 'getObjectBuffer' IN objectStore THEN
      -- Dev fast path: bypass HTTP layer
      videoBuffer = objectStore.getObjectBuffer(s3Key)
      inputFile = path.join(tmpDir, 'nestpic-input-' + crypto.randomUUID() + '.tmp')
      fs.writeFileSync(inputFile, videoBuffer)
      await extractFirstFrame(inputFile, frameFile)
    ELSE
      -- Production path: use signed URL
      signedUrl = await objectStore.generateSignedGetUrl(s3Key, PRESIGN_EXPIRES_IN)
      await extractFirstFrame(signedUrl, frameFile)
    END IF

    RETURN await sharp(frameFile).resize(...).jpeg().toBuffer()
  FINALLY
    IF inputFile EXISTS THEN fs.unlinkSync(inputFile) -- best-effort
    IF frameFile EXISTS THEN fs.unlinkSync(frameFile) -- best-effort
  END TRY
END FUNCTION
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate each bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write unit tests that simulate the thumbnail pipeline in isolation — mock the object store, invoke `processMedia` / `uploadThumbnail` / `processVideo`, and assert the expected outcomes. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **Dev store round-trip test**: Call `putObjectBuffer` on a `SwiftAdapter` instance, then call `getDevStore().get(key)` directly — assert the value is present. (Will pass even on unfixed code, confirming the store itself is correct; the mismatch is in how `processVideo` bypasses it.)
2. **Pooled buffer body test**: Allocate a `Buffer` with a non-zero `byteOffset` (e.g. via `Buffer.allocUnsafe(8192).slice(100, 200)`), pass it through `uploadThumbnail`'s body construction, and assert the resulting `ArrayBuffer` contains only the expected bytes. (Will fail on unfixed code when `byteOffset != 0`.)
3. **`processVideo` dev path test**: Mock `getObjectStore()` to return a `SwiftAdapter`-like object with `getObjectBuffer`. Call `processVideo` and assert ffmpeg is invoked with a local file path, not an HTTP URL. (Will fail on unfixed code — ffmpeg will be called with an HTTP URL.)
4. **Temp file uniqueness test**: Call the temp filename generation logic twice within the same millisecond and assert the two filenames differ. (Will fail on unfixed code using `Date.now()`.)

**Expected Counterexamples**:
- `uploadThumbnail` body contains extra bytes when buffer is pooled
- `processVideo` passes an HTTP URL to ffmpeg in dev instead of a local file path
- Two concurrent `processVideo` calls produce identical temp filenames

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed functions produce the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := processMedia_fixed(input.mediaId, input.s3Key, input.contentType)
  ASSERT thumbnail stored in devStore at 'thumbnails/{mediaId}.jpg'
  ASSERT feed API returns non-null thumbnailUrl for mediaId
  ASSERT stored bytes are valid JPEG (starts with FF D8 FF)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed functions produce the same result as the original functions.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT processMedia_original(input) = processMedia_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for image processing and null-thumbnail rendering, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Image thumbnail preservation**: Verify `processImage` produces identical output before and after the fix (the fix does not touch `processImage`)
2. **Null thumbnail preservation**: Verify feed API continues to return `thumbnailUrl: null` for items with `thumbnail_key IS NULL`
3. **Non-`thumbnails/` key preservation**: Verify feed API continues to return `thumbnailUrl: null` for items whose `thumbnail_key` does not start with `thumbnails/`
4. **Production video path preservation**: Verify `processVideo` still calls `generateSignedGetUrl` and passes the URL to ffmpeg when `getObjectBuffer` is NOT present on the store

### Unit Tests

- Test `uploadThumbnail` with a pooled `Buffer` (non-zero `byteOffset`) and assert the PUT body contains only the correct bytes
- Test `processVideo` in dev mode: mock store with `getObjectBuffer`, assert ffmpeg receives a local file path
- Test `processVideo` in production mode: mock store without `getObjectBuffer`, assert ffmpeg receives an HTTP URL
- Test temp filename generation produces unique names under concurrent calls
- Test that both temp files (input video + output frame) are deleted in the `finally` block even when ffmpeg throws

### Property-Based Tests

- Generate random `Buffer` instances with varying `byteOffset` values and verify the PUT body always contains exactly the right bytes
- Generate random media IDs and content types; verify `processMedia` always writes `thumbnail_key = 'thumbnails/{mediaId}.jpg'` on success
- Generate random object store states and verify the feed API's `thumbnailUrl` logic is consistent with the `thumbnail_key` prefix rule

### Integration Tests

- Full upload → confirm → worker poll → feed API cycle for an image in dev: assert `thumbnailUrl` is non-null and the URL returns HTTP 200
- Full upload → confirm → worker poll → feed API cycle for a video in dev: assert `thumbnailUrl` is non-null and the URL returns HTTP 200
- Verify that a media item with `thumbnail_key IS NULL` renders a grey placeholder without errors after the fix is applied
