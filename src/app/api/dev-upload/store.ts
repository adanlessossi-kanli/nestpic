/**
 * Shared in-memory store for the dev-upload proxy.
 * Kept in a separate module so it can be imported by both the route
 * handler and any code that needs direct access (e.g. tests, SwiftAdapter).
 */

declare global {
  // eslint-disable-next-line no-var
  var __devStore: Map<string, { data: Buffer; contentType: string }> | undefined;
}

if (!global.__devStore) {
  global.__devStore = new Map();
}

export function getDevStore(): Map<string, { data: Buffer; contentType: string }> {
  return global.__devStore!;
}
