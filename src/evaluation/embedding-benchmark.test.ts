/** @file Deterministic tests for trained-model rollout measurement scaffolding. */

import { describe, expect, it } from "vitest";

import {
  EMBEDDING_ACCEPTANCE_THRESHOLDS,
  assessEmbeddingRollout,
  createPendingEmbeddingReport,
} from "./embedding-benchmark";
import { evaluateDataset } from "./run";
import type { EmbeddingProvider } from "@/lib/embeddings/types";

describe("embedding benchmark reporting", () => {
  it("records a lexical-only ablation independently from trained vectors", () => {
    const lexicalOnly: EmbeddingProvider = {
      model: {
        provider: "ablation",
        name: "lexical-only",
        revision: "1",
        version: "1",
        dimensions: 1,
        maxInputTokens: 1,
        deployment: "local",
        purpose: "demo/test",
      },
      embed: (texts) => texts.map(() => [0]),
    };

    const metrics = evaluateDataset(undefined, lexicalOnly);
    console.info(JSON.stringify({ lexicalOnlyTopOneAccuracy: metrics.topOneAccuracy }));
    expect(metrics.topOneAccuracy).toBeGreaterThanOrEqual(0.8);
  });
  it("marks trained results pending instead of inventing credentialed measurements", () => {
    expect(createPendingEmbeddingReport("pinned-model", "immutable-revision")).toEqual(
      expect.objectContaining({
        status: "pending_credentials",
        model: "pinned-model",
        revision: "immutable-revision",
        metrics: null,
      }),
    );
  });

  it("requires quality, duplicate, and false-review gates before rollout", () => {
    const baseline = {
      topOneAccuracy: 0.8,
      duplicateCandidateRate: 0.12,
      falseHumanReviewRate: 0.1,
      constraintEvidenceCorrectness: 0.95,
      historicalRetrievalQuality: 0.8,
      p95LatencyMs: 5,
    };
    expect(assessEmbeddingRollout({ ...baseline, topOneAccuracy: 0.9 }, baseline)).toEqual({
      eligible: true,
      reasons: [],
      rollbackCriteria: EMBEDDING_ACCEPTANCE_THRESHOLDS,
    });
    expect(
      assessEmbeddingRollout(
        { ...baseline, duplicateCandidateRate: 0.25 },
        baseline,
      ).eligible,
    ).toBe(false);
  });
});
