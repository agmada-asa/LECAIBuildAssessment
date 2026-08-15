/** @file Runtime selection tests: embeddings are always API-backed. */

import { describe, expect, it } from "vitest";

import { createConfiguredEmbeddingProvider } from "./config";

describe("embedding runtime configuration", () => {
  it("fails clearly when the API embedding configuration is absent", () => {
    expect(() => createConfiguredEmbeddingProvider({})).toThrow("incomplete");
  });

  it("requires a pinned revision and model input limits for production", () => {
    expect(() =>
      createConfiguredEmbeddingProvider({
        EMBEDDING_PROVIDER: "openai-compatible",
        OPENAI_COMPATIBLE_BASE_URL: "https://example.test/v1",
        OPENAI_COMPATIBLE_API_KEY: "secret",
        OPENAI_COMPATIBLE_EMBEDDING_MODEL: "example-embed",
        OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS: "3",
      }),
    ).toThrow("incomplete");
  });

  it("records provider, immutable revision, dimensions, deployment, and purpose", () => {
    const provider = createConfiguredEmbeddingProvider({
      EMBEDDING_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_BASE_URL: "https://example.test/v1",
      OPENAI_COMPATIBLE_API_KEY: "secret",
      OPENAI_COMPATIBLE_EMBEDDING_MODEL: "example-embed-2026-08-01",
      OPENAI_COMPATIBLE_EMBEDDING_REVISION: "2026-08-01",
      OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS: "3",
      OPENAI_COMPATIBLE_EMBEDDING_MAX_INPUT_TOKENS: "8192",
    });

    expect(provider.model).toMatchObject({
      provider: "openai-compatible",
      name: "example-embed-2026-08-01",
      revision: "2026-08-01",
      dimensions: 3,
      deployment: "hosted",
      purpose: "production",
    });
  });

  it("requires API embeddings even when Codex CLI supplies candidate analysis", () => {
    expect(() =>
      createConfiguredEmbeddingProvider({
        NODE_ENV: "production",
        PATH: "/usr/local/bin:/usr/bin",
        CODEX_HOME: "/Users/example/.codex",
      }),
    ).toThrow("OpenAI-compatible embedding configuration is incomplete");
  });

  it("does not require an API analysis model when Codex CLI supplies candidate analysis", () => {
    const provider = createConfiguredEmbeddingProvider({
      NODE_ENV: "production",
      EMBEDDING_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_BASE_URL: "https://example.test/v1",
      OPENAI_COMPATIBLE_API_KEY: "secret",
      OPENAI_COMPATIBLE_EMBEDDING_MODEL: "example-embed-2026-08-01",
      OPENAI_COMPATIBLE_EMBEDDING_REVISION: "2026-08-01",
      OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS: "3",
      OPENAI_COMPATIBLE_EMBEDDING_MAX_INPUT_TOKENS: "8192",
    });

    expect(provider.model).toMatchObject({
      provider: "openai-compatible",
      name: "example-embed-2026-08-01",
      purpose: "production",
    });
  });

  it("rejects local embedding providers", () => {
    expect(() =>
      createConfiguredEmbeddingProvider({
        EMBEDDING_PROVIDER: "demo-feature-hash",
      }),
    ).toThrow("Only openai-compatible API embeddings are supported");
  });

  it("permits the deterministic fixture only inside the test process", () => {
    const provider = createConfiguredEmbeddingProvider({
      NODE_ENV: "test",
      EMBEDDING_PROVIDER: "demo-feature-hash",
    });

    expect(provider.model.purpose).toBe("demo/test");
  });

  it("keeps ordinary tests deterministic when a local env file selects production", () => {
    const provider = createConfiguredEmbeddingProvider({
      NODE_ENV: "test",
      EMBEDDING_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_BASE_URL: "https://example.invalid/v1",
      OPENAI_COMPATIBLE_API_KEY: "not-used",
      OPENAI_COMPATIBLE_EMBEDDING_MODEL: "hosted-model",
      OPENAI_COMPATIBLE_EMBEDDING_REVISION: "revision",
      OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS: "8",
      OPENAI_COMPATIBLE_EMBEDDING_MAX_INPUT_TOKENS: "100",
    });

    expect(provider.model.purpose).toBe("demo/test");
  });
});
