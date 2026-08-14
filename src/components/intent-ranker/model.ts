/** @file Shared display metadata and request helpers for the intent-ranking workbench. */

import type { ConversationLog } from "@/lib/conversations/schema";
import type { ProviderId } from "@/lib/providers/types";
import type { RankErrorResponse, RankSuccessResponse } from "@/lib/ranking/api";
import type {
  ConversationMessage,
  RankingInput,
  Scenario,
  SignalKey,
  SignalWeights,
} from "@/lib/ranking/types";

export const SIGNAL_META: Record<
  SignalKey,
  { label: string; shortLabel: string; color: string; dot: string }
> = {
  semantic: {
    label: "Semantic similarity",
    shortLabel: "Semantic",
    color: "bg-sky-500",
    dot: "bg-sky-500",
  },
  constraints: {
    label: "Constraint consistency",
    shortLabel: "Constraints",
    color: "bg-primary",
    dot: "bg-primary",
  },
  history: {
    label: "Historical pattern",
    shortLabel: "History",
    color: "bg-violet-500",
    dot: "bg-violet-500",
  },
};

export const SIGNAL_KEYS = Object.keys(SIGNAL_META) as SignalKey[];

/** Formats a normalised value as a whole-number percentage for compact labels. */
export function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Formats a signed normalised score change as percentage points. */
export function pointDelta(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pts`;
}

/** Converts a walkthrough snapshot into the canonical log used by imports. */
export function scenarioConversationLog(
  scenario: Scenario,
  messages: ConversationMessage[],
): ConversationLog {
  return {
    conversationId: scenario.id,
    userId: scenario.userName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    domain: { name: scenario.userRole },
    messages: messages.map((message, index) => ({
      ...message,
      timestamp: Number.isNaN(Date.parse(message.timestamp))
        ? `2026-08-14T${message.timestamp}:00.000Z`
        : new Date(message.timestamp).toISOString(),
      id: message.id || `M${index + 1}`,
    })),
    acceptedOutcomes: scenario.history
      .filter((outcome) => outcome.accepted)
      .map((outcome) => ({
        id: outcome.id,
        interpretationId: outcome.interpretationId,
        title:
          scenario.interpretations.find((item) => item.id === outcome.interpretationId)
            ?.title ?? "Accepted task",
        summary: outcome.summary,
        semanticTerms: outcome.terms,
      })),
  };
}

/** Returns the first generated ID that does not collide with source IDs. */
export function nextMessageId(messages: ConversationMessage[]): string {
  const usedIds = new Set(messages.map((message) => message.id));
  let suffix = messages.length + 1;
  while (usedIds.has(`M${suffix}`)) suffix += 1;
  return `M${suffix}`;
}

/** Sends one complete canonical log to the unified server pipeline. */
export async function requestRanking(
  conversation: ConversationLog,
  provider: ProviderId,
  weights: SignalWeights,
  previousInput?: RankingInput,
  signal?: AbortSignal,
): Promise<RankSuccessResponse> {
  const response = await fetch("/api/rank", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, conversation, weights, previousInput }),
    signal,
  });
  const body = (await response.json()) as RankSuccessResponse | RankErrorResponse;
  if (!response.ok || "error" in body) {
    throw new Error(
      "error" in body ? body.error.message : "The ranking service returned an invalid response.",
    );
  }
  return body;
}
