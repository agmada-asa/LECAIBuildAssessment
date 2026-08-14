/** @file Exact-match helpers for reconciling queued work with persisted ranking runs. */

import { createHash } from "node:crypto";

import type { ConversationLog } from "@/lib/conversations/schema";
import type { ProviderId } from "@/lib/providers/types";
import type { SignalWeights } from "@/lib/ranking/types";
import type {
  PersistedRankingRun,
  PersistedRunReference,
  QueueRankingResult,
} from "./types";

/** Produces the stable identity shared by direct ranking and queue repair. */
export function rankingRunIdempotencyKey(input: {
  provider: ProviderId;
  conversation: ConversationLog;
  weights: SignalWeights;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      provider: input.provider,
      conversationId: input.conversation.conversationId,
      messages: input.conversation.messages,
      weights: input.weights,
    }))
    .digest("hex");
}

/** Rebuilds the public queue result from an exact persisted run. */
export function queueResultFromPersistedRun(
  run: PersistedRankingRun,
  reference: PersistedRunReference,
): QueueRankingResult {
  return {
    provider: {
      id: run.provider,
      name:
        run.provider === "demo"
          ? "Deterministic fallback"
          : run.provider === "codex"
            ? "Codex CLI"
            : "OpenAI-compatible API",
      fallback: run.provider === "demo",
      notes: "Reconciled from the previously persisted analysis.",
    },
    input: run.input,
    result: run.result,
    persistence: {
      enabled: true,
      identified: true,
      state: reference.state,
      rankingRunId: reference.id,
      duplicate: true,
    },
  };
}
