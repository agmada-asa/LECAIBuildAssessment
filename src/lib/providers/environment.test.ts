/**
 * @file Security regression tests for the environment passed to provider CLIs.
 *
 * Provider subprocesses need basic runtime paths, but must not inherit
 * unrelated application credentials from the Next.js server.
 */

import { describe, expect, it } from "vitest";

import { buildProviderEnvironment } from "./environment";

describe("buildProviderEnvironment", () => {
  it("keeps required runtime paths and removes credential-like variables", () => {
    const environment = buildProviderEnvironment({
      NODE_ENV: "test",
      HOME: "/Users/example",
      PATH: "/usr/local/bin:/usr/bin",
      CODEX_HOME: "/Users/example/.codex",
      LANG: "en_GB.UTF-8",
      OPENAI_API_KEY: "sensitive-openai-value",
      DATABASE_URL: "sensitive-database-value",
      HTTP_PROXY: "https://user:password@proxy.example",
    });

    expect(environment).toEqual({
      NODE_ENV: "test",
      HOME: "/Users/example",
      PATH: "/usr/local/bin:/usr/bin",
      CODEX_HOME: "/Users/example/.codex",
      LANG: "en_GB.UTF-8",
    });
    expect(JSON.stringify(environment)).not.toContain("sensitive");
    expect(environment).not.toHaveProperty("HTTP_PROXY");
  });
});
