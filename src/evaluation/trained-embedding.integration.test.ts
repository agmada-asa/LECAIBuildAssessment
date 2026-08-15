/** @file Opt-in quality evaluation against the explicitly configured trained model. */

import { describe, expect, it } from "vitest";

import { createConfiguredEmbeddingProvider } from "@/lib/embeddings/config";
import { rankConversationAsync, reweightRankingResult } from "@/lib/ranking/engine";
import { DEFAULT_WEIGHTS } from "@/lib/ranking/policy";
import { EVALUATION_DATASET } from "./dataset";
import { EMBEDDING_ACCEPTANCE_THRESHOLDS } from "./embedding-benchmark";

const enabled = process.env.RUN_TRAINED_EMBEDDING_EVAL === "1";

describe.skipIf(!enabled)("configured trained embedding integration", () => {
  it("clears the labelled scorer accuracy gate with the pinned real model", async () => {
    const provider = createConfiguredEmbeddingProvider(process.env);
    expect(provider.model.purpose).toBe("production");
    let correct = 0;
    const latencies: number[] = [];
    const completed: Array<{ expected: string; result: Awaited<ReturnType<typeof rankConversationAsync>> }> = [];

    for (const item of EVALUATION_DATASET) {
      const startedAt = performance.now();
      const result = await rankConversationAsync(
        item.input,
        item.conversation.messages,
        DEFAULT_WEIGHTS,
        undefined,
        provider,
      );
      latencies.push(performance.now() - startedAt);
      completed.push({ expected: item.expectedWinner, result });
      if (result.ranking[0].id === item.expectedWinner) correct += 1;
    }

    const sortedLatencies = [...latencies].sort((left, right) => left - right);
    const p95 = sortedLatencies[Math.ceil(sortedLatencies.length * 0.95) - 1];
    const recalibrated = completed.filter(({ expected, result }) =>
      reweightRankingResult(result, { semantic: 20, constraints: 60, history: 20 })
        .ranking[0].id === expected,
    ).length / completed.length;
    console.info(JSON.stringify({
      model: provider.model.name,
      revision: provider.model.revision,
      dimensions: provider.model.dimensions,
      cases: EVALUATION_DATASET.length,
      topOneAccuracy: correct / EVALUATION_DATASET.length,
      recalibratedTopOneAccuracy: recalibrated,
      p95LatencyMs: Math.round(p95),
    }));

    expect(correct / EVALUATION_DATASET.length).toBeGreaterThanOrEqual(
      EMBEDDING_ACCEPTANCE_THRESHOLDS.minimumTopOneAccuracy,
    );
  }, 120_000);
});
