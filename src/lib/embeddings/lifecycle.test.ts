/** @file Contract tests for embedding identity, migration, and safe comparison. */

import { describe, expect, it } from "vitest";

import {
  cacheKey,
  embeddingNamespace,
  planEmbeddingMigration,
} from "./lifecycle";
import { cosineSimilarityForModel } from "./similarity";
import type { EmbeddingModel, StoredEmbedding } from "./types";

const trained: EmbeddingModel = {
  provider: "openai-compatible",
  name: "example-embed-2026-08-01",
  revision: "2026-08-01",
  version: "2026-08-01",
  dimensions: 3,
  maxInputTokens: 8_192,
  deployment: "hosted",
  purpose: "production",
};

describe("embedding lifecycle", () => {
  it("namespaces normalized input by the complete model identity", () => {
    expect(cacheKey(trained, "  Hello\n world ")).toBe(
      `${embeddingNamespace(trained)}:Hello world`,
    );
    expect(
      embeddingNamespace({ ...trained, dimensions: trained.dimensions + 1 }),
    ).not.toBe(embeddingNamespace(trained));
    expect(
      embeddingNamespace({ ...trained, revision: "2026-09-01" }),
    ).not.toBe(embeddingNamespace(trained));
  });

  it("blocks cosine comparison across model revisions", () => {
    expect(
      cosineSimilarityForModel(
        { model: trained, vector: [1, 0, 0] },
        { model: trained, vector: [1, 0, 0] },
      ),
    ).toBe(1);
    expect(() =>
      cosineSimilarityForModel(
        { model: trained, vector: [1, 0, 0] },
        {
          model: { ...trained, revision: "2026-09-01", version: "2026-09-01" },
          vector: [1, 0, 0],
        },
      ),
    ).toThrow("different embedding models");
  });

  it("plans explicit re-embedding for every stale stored vector", () => {
    const records: StoredEmbedding[] = [
      { id: "current", model: trained, vector: [1, 0, 0] },
      {
        id: "stale",
        model: { ...trained, revision: "old", version: "old" },
        vector: [1, 0, 0],
      },
    ];

    expect(planEmbeddingMigration(records, trained)).toEqual({
      compatibleIds: ["current"],
      reembedIds: ["stale"],
      targetNamespace: embeddingNamespace(trained),
    });
  });
});
