# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Thumbnail Not Served After Upload
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the three bugs exist
  - **Scoped PBT Approach**: Scope to concrete failing cases for each bug condition
  - Test 1 (dev store mismatch): Call `putObjectBuffer` on a `SwiftAdapter` instance, then call `getDevStore().get(key)` from a separate import context — assert the value is present. Demonstrates the module-instance mismatch.
  - Test 2 (pooled buffer body): Allocate a `Buffer` with non-zero `byteOffset` via `Buffer.allocUnsafe(8192).slice(100, 200)`, pass it through `uploadThumbnail`'s body construction, assert the resulting `ArrayBuffer` contains only the expected bytes (not the full slab). Will fail when `byteOffset != 0`.
  - Test 3 (processVideo dev path): Mock `getObjectStore()` to return a store with `getObjectBuffer`. Call `processVideo` and assert ffmpeg is invoked with a local file path, NOT an HTTP URL. Will fail on unfixed code — ffmpeg will receive an HTTP URL.
  - Test 4 (temp filename collision): Call the temp filename generation logic twice within the same millisecond and assert the two filenames differ. Will fail on unfixed code using `Date.now()`.
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bugs exist)
  - Document counterexamples found (e.g., "processVideo passes HTTP URL to ffmpeg instead of local file path", "uploadThumbnail body contains extra bytes when byteOffset != 0")
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.9_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Buggy Input Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: `processImage` produces a valid JPEG buffer on unfixed code for any image input
  - Observe: feed API returns `thumbnailUrl: null` for items with `thumbnail_key IS NULL` on unfixed code
  - Observe: feed API returns `thumbnailUrl: null` for items whose `thumbnail_key` does not start with `thumbnails/` on unfixed code
  - Observe: `processVideo` calls `generateSignedGetUrl` and passes the URL to ffmpeg when `getObjectBuffer` is NOT present on the store (production path)
  - Write property-based test: for all image media IDs and content types, `processImage` produces a buffer starting with `FF D8 FF` (valid JPEG magic bytes)
  - Write property-based test: for all media items with `thumbnail_key IS NULL`, feed API returns `thumbnailUrl: null`
  - Write property-based test: for all `thumbnail_key` values not starting with `thumbnails/`, feed API returns `thumbnailUrl: null`
  - Write unit test: when store has no `getObjectBuffer`, `processVideo` calls `generateSignedGetUrl` and passes the result to ffmpeg (production path preserved)
  - Verify all tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.5, 3.6, 3.7, 3.8_

- [x] 3. Fix thumbnail display bugs

  - [x] 3.1 Fix corrupt JPEG body in `uploadThumbnail` (production)
    - In `src/lib/thumbnail/processor.ts`, replace the `ArrayBuffer` slice with a direct `Buffer` pass
    - Change `body: jpegBuffer.buffer.slice(jpegBuffer.byteOffset, jpegBuffer.byteOffset + jpegBuffer.byteLength) as ArrayBuffer` to `body: jpegBuffer`
    - Node.js `fetch` accepts a `Buffer` directly, eliminating the pooled-buffer offset issue
    - _Bug_Condition: isBugCondition(input) where env = 'prod' AND jpegBuffer.byteOffset != 0_
    - _Expected_Behavior: PUT body contains exactly the JPEG bytes — stored object is a valid JPEG (starts with FF D8 FF)_
    - _Preservation: Production S3 upload behavior unchanged for non-pooled buffers; dev path (putObjectBuffer) unchanged_
    - _Requirements: 1.3, 2.3_

  - [x] 3.2 Add `getObjectBuffer` fast path to `processVideo` (dev)
    - In `src/lib/thumbnail/processor.ts`, mirror the pattern from `processImage`
    - Before calling `generateSignedGetUrl`, check `'getObjectBuffer' in objectStore`
    - If true: read video bytes via `objectStore.getObjectBuffer(s3Key)`, write to a temp input file, pass that file path to `extractFirstFrame` — bypassing the HTTP layer
    - If false: use the existing `generateSignedGetUrl` + HTTP path (production unchanged)
    - _Bug_Condition: isBugCondition(input) where env = 'dev' AND contentType starts with 'video/'_
    - _Expected_Behavior: ffmpeg receives a local file path; frame extraction succeeds; thumbnail is written to devStore_
    - _Preservation: Production video path (generateSignedGetUrl → ffmpeg HTTP URL) remains unchanged_
    - _Requirements: 1.5, 1.6, 2.5, 2.6_

  - [x] 3.3 Use `crypto.randomUUID()` for temp filenames and clean up both temp files
    - Replace `Date.now()` with `crypto.randomUUID()` for the frame output file name
    - Declare `inputFile` variable before the try block, initialized to `null`
    - In the dev fast path, assign `inputFile = path.join(tmpDir, 'nestpic-input-' + crypto.randomUUID() + '.tmp')`
    - In the `finally` block, delete both `inputFile` (if non-null) and `frameFile` with best-effort `unlinkSync`
    - _Bug_Condition: isBugCondition(input) where two concurrent processVideo calls occur within the same millisecond_
    - _Expected_Behavior: temp filenames are unique across concurrent calls; both input and frame temp files are cleaned up_
    - _Preservation: Single-call cleanup behavior unchanged; production path cleanup unchanged_
    - _Requirements: 1.7, 1.9, 2.7, 2.8_

  - [x] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Thumbnail Served After Upload
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - The tests from task 1 encode the expected behavior
    - When these tests pass, it confirms the expected behavior is satisfied
    - Run all four bug condition tests from step 1
    - **EXPECTED OUTCOME**: All tests PASS (confirms all three bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 2.8_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Buggy Input Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run all preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm image thumbnail generation, null-thumbnail rendering, non-`thumbnails/` key handling, and production video path all behave identically after the fix

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the full test suite: `npx vitest --run`
  - Ensure all property-based tests and unit tests pass
  - Confirm no regressions in upload, feed, albums, or auth flows
  - Ask the user if any questions arise
