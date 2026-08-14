/** @file Contract and behaviour tests for the offline embedding provider. */

import { describe, expect, it } from "vitest";

import { cosineSimilarity } from "./similarity";
import { CachingEmbeddingProvider, LocalEmbeddingProvider } from "./provider";

describe("LocalEmbeddingProvider", () => {
  it("returns fixed-size finite vectors from one named model", () => {
    const provider = new LocalEmbeddingProvider();
    const vectors = provider.embed([
      "Build a presentation",
      "The accepted outcome was a slide deck",
    ]);

    expect(provider.model).toMatchObject({
      name: "resolve-local-feature-hash",
      version: "1.0.0",
      dimensions: 256,
    });
    expect(vectors).toHaveLength(2);
    vectors.forEach((vector) => {
      expect(vector).toHaveLength(provider.model.dimensions);
      expect(vector.every(Number.isFinite)).toBe(true);
    });
  });

  it("places presentation paraphrases closer than unrelated tasks", () => {
    const provider = new LocalEmbeddingProvider();
    const [slides, deck, powerpoint, presentation, csv] = provider.embed([
      "slides",
      "deck",
      "PowerPoint",
      "presentation",
      "raw CSV rows",
    ]);

    for (const synonym of [deck, powerpoint, presentation]) {
      expect(cosineSimilarity(slides, synonym)).toBeGreaterThan(0.8);
      expect(cosineSimilarity(slides, synonym)).toBeGreaterThan(
        cosineSimilarity(slides, csv),
      );
    }
  });
});

describe("CachingEmbeddingProvider", () => {
  it("does not recompute duplicate text for the same model", () => {
    const inner = new LocalEmbeddingProvider();
    const cached = new CachingEmbeddingProvider(inner, 10);

    cached.embed(["same text", "same text"]);
    cached.embed(["same text"]);

    expect(cached.stats()).toEqual({ hits: 2, misses: 1, size: 1 });
  });
});
