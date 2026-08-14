/** @file Serializable request and response types for the unified ranking API. */

import type { ConversationLog } from "@/lib/conversations/schema";
import type { ProviderId } from "@/lib/providers/types";
import type { RankingInput, RankingResult, SignalWeights } from "./types";

export type RankRequest = {
  provider: ProviderId;
  conversation: ConversationLog;
  weights?: SignalWeights;
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
};

export type RankErrorResponse = {
  error: {
    code:
      | "invalid_json"
      | "invalid_conversation"
      | "provider_unavailable"
      | "provider_failure"
      | "invalid_provider_output";
    message: string;
    issues?: Array<{ path: string; message: string }>;
  };
};
