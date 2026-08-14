/** @file Contract tests for server-only OpenAI-compatible embedding endpoints. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAICompatibleEmbeddingProvider } from "./openai-compatible";

describe("OpenAICompatibleEmbeddingProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends batched input with a bearer key and caches validated vectors", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { index: 0, embedding: [1, 0, 0] },
            { index: 1, embedding: [0, 1, 0] },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embeddings.example.test/v1/",
      apiKey: "server-secret",
      model: "example-embed",
      version: "2026-08",
      dimensions: 3,
    });

    await provider.prepare(["message", "candidate"]);
    await provider.prepare(["candidate"]);

    expect(provider.embed(["message", "candidate"])).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://embeddings.example.test/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer server-secret" }),
        body: JSON.stringify({ model: "example-embed", input: ["message", "candidate"] }),
      }),
    );
  });

  it("rejects malformed dimensions without including credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] })),
      ),
    );
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embeddings.example.test/v1",
      apiKey: "must-not-appear",
      model: "example-embed",
      version: "1",
      dimensions: 3,
    });

    await expect(provider.prepare(["message"])).rejects.not.toThrow("must-not-appear");
    await expect(provider.prepare(["message"])).rejects.toThrow("dimension");
  });

  it("batches long inputs, retries rate limits, and exposes only aggregate metrics", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }] })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ index: 0, embedding: [0, 1, 0] }] })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embeddings.example.test/v1",
      apiKey: "server-secret",
      model: "example-embed-2026-08-01",
      revision: "2026-08-01",
      dimensions: 3,
      maxBatchSize: 1,
      maxInputCharacters: 8,
      retryDelayMs: 0,
      maximumRetries: 1,
    });

    await provider.prepare(["alpha beta gamma"]);
    const [vector] = provider.embed(["alpha beta gamma"]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vector).toHaveLength(3);
    expect(provider.provenance("alpha beta gamma")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chunkIndex: 0, sourceStart: 0 }),
        expect.objectContaining({ chunkIndex: 1 }),
      ]),
    );
    expect(provider.stats()).toMatchObject({
      requests: 3,
      retries: 1,
      failures: 0,
      cacheMisses: 1,
    });
    expect(JSON.stringify(provider.stats())).not.toContain("alpha beta");
  });

  it("rejects duplicate response indexes as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { index: 0, embedding: [1, 0, 0] },
              { index: 0, embedding: [0, 1, 0] },
            ],
          }),
        ),
      ),
    );
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embeddings.example.test/v1",
      apiKey: "secret",
      model: "example-embed-2026-08-01",
      revision: "2026-08-01",
      dimensions: 3,
    });

    await expect(provider.prepare(["first", "second"])).rejects.toThrow(
      "invalid response",
    );
  });
});
