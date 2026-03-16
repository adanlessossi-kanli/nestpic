const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
]);

const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB

export type ValidateFileInput = {
  mimeType: string;
  size: number;
};

export type ValidateFileResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } };

export function validateFile(input: ValidateFileInput): ValidateFileResult {
  if (!ACCEPTED_MIME_TYPES.has(input.mimeType)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_FILE_TYPE',
        message: `File type "${input.mimeType}" is not supported. Accepted types: JPEG, PNG, GIF, WebP, MP4, MOV, AVI.`,
      },
    };
  }

  if (input.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: `File size exceeds the 200 MB limit.`,
      },
    };
  }

  return { ok: true };
}

export { ACCEPTED_MIME_TYPES, MAX_FILE_SIZE_BYTES };
