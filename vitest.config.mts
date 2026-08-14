/**
 * @file Vitest configuration shared by domain and browser-like component tests.
 *
 * The alias mirrors `tsconfig.json` so tests import production modules through
 * the same stable `@/` paths used by Next.js.
 */

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
