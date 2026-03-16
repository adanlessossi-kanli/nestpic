export interface ObjectStore {
  /**
   * Generate a presigned PUT URL for direct client-to-store uploads.
   * The URL is constrained to the given contentType and contentLength.
   */
  generatePresignedPutUrl(
    key: string,
    contentType: string,
    contentLength: number,
    expiresIn: number
  ): Promise<string>;

  /**
   * Generate a signed GET URL for serving a stored object via CDN or direct access.
   */
  generateSignedGetUrl(key: string, expiresIn: number): Promise<string>;

  /**
   * Delete an object from the store.
   */
  deleteObject(key: string): Promise<void>;

  /**
   * Retrieve metadata for an object without downloading its body.
   */
  headObject(key: string): Promise<{ contentLength: number; contentType: string }>;
}
