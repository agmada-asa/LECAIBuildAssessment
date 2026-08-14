/** @file Stable pseudonymous identity for one browser profile. */

export const DEVICE_ID_HEADER = "x-device-id";
const STORAGE_KEY = "resolve.device-id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns the existing browser-profile UUID or creates one on first use. */
export function getOrCreateDeviceId(): string {
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const created = window.crypto.randomUUID();
  window.localStorage.setItem(STORAGE_KEY, created);
  return created;
}

/** Reads a syntactically valid browser-profile identifier from an API request. */
export function deviceIdFromRequest(request: Request): string | undefined {
  const value = request.headers.get(DEVICE_ID_HEADER);
  return value && UUID.test(value) ? value : undefined;
}
