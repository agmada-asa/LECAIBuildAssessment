/** @file Shared display metadata and request helpers for the intent-ranking workbench. */

import type { ConversationLog } from "@/lib/conversations/schema";
import type { ProviderId } from "@/lib/providers/types";
import type { RankSuccessResponse } from "@/lib/ranking/api";
import type {
  ConversationMessage,
  SignalKey,
  SignalWeights,
} from "@/lib/ranking/types";
import { DEVICE_ID_HEADER, getOrCreateDeviceId } from "@/lib/persistence/device";
import type { QueuedTaskReference } from "@/lib/persistence/types";

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
  signal?: AbortSignal,
  queuedTask?: QueuedTaskReference,
): Promise<RankSuccessResponse> {
  const response = await fetch("/api/rank", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [DEVICE_ID_HEADER]: getOrCreateDeviceId(),
    },
    body: JSON.stringify({ provider, conversation, weights, queuedTask }),
    signal,
  });
  const rawBody = (await response.json()) as unknown;
  if (
    !response.ok ||
    (typeof rawBody === "object" &&
      rawBody !== null &&
      "error" in rawBody &&
      Boolean((rawBody as { error: unknown }).error))
  ) {
    const errorPayload = (rawBody as { error?: unknown })?.error;
    const message =
      typeof errorPayload === "string"
        ? errorPayload
        : typeof errorPayload === "object" &&
            errorPayload !== null &&
            "message" in errorPayload &&
            typeof (errorPayload as { message: unknown }).message === "string"
          ? (errorPayload as { message: string }).message
          : "The ranking service returned an invalid response.";
    throw new Error(message);
  }
  return rawBody as RankSuccessResponse;
}
