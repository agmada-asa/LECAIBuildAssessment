/** @file Opt-in quality evaluation against the explicitly configured trained model. */

import { describe, expect, it } from "vitest";

import { createConfiguredEmbeddingProvider } from "@/lib/embeddings/config";
import { rankConversationAsync } from "@/lib/ranking/engine";
import { DEFAULT_WEIGHTS } from "@/lib/ranking/scenarios";
import { EVALUATION_DATASET } from "./dataset";
import { EMBEDDING_ACCEPTANCE_THRESHOLDS } from "./embedding-benchmark";

const enabled = process.env.RUN_TRAINED_EMBEDDING_EVAL === "1";

describe.skipIf(!enabled)("configured trained embedding integration", () => {
  it("clears the labelled scorer accuracy gate with the pinned real model", async () => {
    const provider = createConfiguredEmbeddingProvider(process.env);
    expect(provider.model.purpose).toBe("production");
    let correct = 0;

    for (const item of EVALUATION_DATASET) {
      const result = await rankConversationAsync(
        item.input,
        item.conversation.messages,
        DEFAULT_WEIGHTS,
        undefined,
        provider,
      );
      if (result.ranking[0].id === item.expectedWinner) correct += 1;
    }

    expect(correct / EVALUATION_DATASET.length).toBeGreaterThanOrEqual(
      EMBEDDING_ACCEPTANCE_THRESHOLDS.minimumTopOneAccuracy,
    );
  }, 120_000);
});
