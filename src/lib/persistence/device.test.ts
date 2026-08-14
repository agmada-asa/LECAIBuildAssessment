/** @vitest-environment jsdom */
/** @file Tests for stable, privacy-preserving browser profile identifiers. */

import { beforeEach, describe, expect, it } from "vitest";

import { DEVICE_ID_HEADER, getOrCreateDeviceId } from "./device";

describe("browser device identity", () => {
  beforeEach(() => localStorage.clear());

  it("creates one UUID and reuses it for the browser profile", () => {
    const first = getOrCreateDeviceId();

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(getOrCreateDeviceId()).toBe(first);
    expect(DEVICE_ID_HEADER).toBe("x-device-id");
  });
});
