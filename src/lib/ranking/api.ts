/** @file Serializable request and response types for the unified ranking API. */

import type { ConversationLog } from "@/lib/conversations/schema";
import type { ProviderId } from "@/lib/providers/types";
import type { RankingInput, RankingResult, SignalWeights } from "./types";
import type { ConversationState, QueuedTaskReference } from "@/lib/persistence/types";

export type RankRequest = {
  provider: ProviderId;
  conversation: ConversationLog;
  weights?: SignalWeights;
  /** Normalized catalogue shown by the preceding run, used for truthful deltas. */
  previousInput?: RankingInput;
  /** Exact pending queue revision that should receive this direct result. */
  queuedTask?: QueuedTaskReference;
};

export type RankSuccessResponse = {
  provider: {
    id: ProviderId;
    name: string;
    fallback: boolean;
    notes: string;
  };
  /** Normalized candidates and evidence rules used for deterministic reweighting. */
  input: RankingInput;
  result: RankingResult;
  persistence: {
    enabled: boolean;
    identified: boolean;
    state?: ConversationState;
    rankingRunId?: string;
    duplicate?: boolean;
    message?: string;
  };
};

export type RankErrorResponse = {
  error: {
    code:
      | "invalid_json"
      | "invalid_conversation"
      | "provider_unavailable"
      | "provider_failure"
      | "provider_rate_limited"
      | "invalid_provider_output"
      | "candidate_generation_unavailable"
      | "embedding_failure";
    message: string;
    issues?: Array<{ path: string; message: string }>;
  };
};
