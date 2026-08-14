/**
 * @file Bounded, restart-safe processor for durable conversational ranking tasks.
 *
 * The caller supplies the ranking operation so HTTP routes and integration tests
 * share lease, retry, and stale-revision behavior without a background daemon.
 */

import type {
  QueueRankingRequest,
  QueueRankingResult,
  RankingRepository,
} from "@/lib/persistence/types";

export type QueueProcessorResult = {
  taskId: string;
  revision: number;
  state: "pending" | "human_review" | "decided" | "failed";
};

export type RankQueuedConversation = (
  request: QueueRankingRequest,
) => Promise<QueueRankingResult>;

/** Claims and processes at most one bounded batch for a single owner. */
export async function processQueuedTasks(
  repository: RankingRepository,
  ownerId: string,
  rank: RankQueuedConversation,
  options: { limit?: number; leaseDurationMs?: number } = {},
): Promise<QueueProcessorResult[]> {
  const claims = await repository.claimRankingTasks(ownerId, options.limit ?? 5, {
    leaseDurationMs: options.leaseDurationMs,
  });
  const processed: QueueProcessorResult[] = [];

  for (const claim of claims) {
    try {
      const result = await rank(claim.request);
      const committed = await repository.completeRankingTask(claim, result);
      processed.push({
        taskId: claim.id,
        revision: claim.revision,
        state: committed
          ? result.result.uncertain
            ? "human_review"
            : "decided"
          : "pending",
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Analysis failed. Retry this task when the provider is available.";
      const committed = await repository.failRankingTask(
        claim,
        message,
      );
      processed.push({
        taskId: claim.id,
        revision: claim.revision,
        state: committed ? "failed" : "pending",
      });
    }
  }

  return processed;
}
