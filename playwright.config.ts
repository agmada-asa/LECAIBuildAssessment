/** @file Browser-level walkthrough configuration using the installed Chrome channel. */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://localhost:3011",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec next start -p 3011",
    env: { RESOLVE_ENABLE_TEST_PROVIDER: "1" },
    url: "http://localhost:3011",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
