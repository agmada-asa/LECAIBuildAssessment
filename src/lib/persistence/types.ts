/** @file Provider-neutral persistence contracts for conversations and outcomes. */

import type { ConversationLog } from "@/lib/conversations/schema";
import type { ProviderId } from "@/lib/providers/types";
import type { RankSuccessResponse } from "@/lib/ranking/api";
import type {
  RankingInput,
  RankingResult,
  SignalWeights,
} from "@/lib/ranking/types";

export type ConversationState =
  | "pending"
  | "processing"
  | "human_review"
  | "decided"
  | "failed";

export type PersistedRankingRun = {
  /** Device/browser owner; distinct from the user named in an imported log. */
  ownerId: string;
  idempotencyKey: string;
  provider: ProviderId;
  /** Complete normalized policy used to calculate the persisted result. */
  weights: SignalWeights;
  conversation: ConversationLog;
  input: RankingInput;
  result: RankingResult;
  /** Candidate key to vector from the run's recorded embedding model. */
  interpretationEmbeddings?: Record<string, number[]>;
};

export type PersistedRunReference = {
  id: string;
  conversationId: string;
  state: ConversationState;
  duplicate: boolean;
};

export type OutcomeDecision = "accepted" | "corrected";

export type StoredTaskOutcome = {
  id: string;
  /** Device/browser owner used for authorization and history isolation. */
  ownerId: string;
  userId: string;
  domainName?: string;
  sourceRankingRunId?: string;
  interpretationKey?: string;
  title: string;
  summary: string;
  semanticTerms: string[];
  features: string[];
  decision: OutcomeDecision;
  /** Whether this exact outcome should contribute positive historical evidence. */
  accepted: boolean;
  embedding: number[];
  embeddingModel: string;
  embeddingVersion: string;
};

export type SimilarOutcomeQuery = {
  ownerId: string;
  userId: string;
  domainName?: string;
  embedding: number[];
  embeddingModel: string;
  embeddingVersion: string;
  limit: number;
};

export type SimilarTaskOutcome = StoredTaskOutcome & { similarity: number };

export type StoredRankingState = {
  reference: PersistedRunReference;
  run: PersistedRankingRun;
};

/** Immutable ranking request snapshot stored by the conversational queue. */
export type QueueRankingRequest = {
  ownerId: string;
  provider: ProviderId;
  conversation: ConversationLog;
  weights?: SignalWeights;
  previousInput?: RankingInput;
};

/** Complete rank response retained for inspection and human review. */
export type QueueRankingResult = RankSuccessResponse;

export type QueuedRankingTask = {
  id: string;
  externalConversationId: string;
  revision: number;
  state: ConversationState;
  attempts: number;
  request: QueueRankingRequest;
  result?: QueueRankingResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

/** Stable queue identity supplied by a client that already enqueued the work. */
export type QueuedTaskReference = Pick<QueuedRankingTask, "id" | "revision">;

/** Lease-bound claim; revision and token make completion compare-and-swap safe. */
export type QueuedRankingClaim = QueuedRankingTask & { leaseToken: string };

/** Persistence operations consumed by the ranking and feedback routes. */
export interface RankingRepository {
  persistRankingRun(run: PersistedRankingRun): Promise<PersistedRunReference>;
  storeOutcome(outcome: StoredTaskOutcome): Promise<void>;
  /** Resolves one owned human-review run and its exact queue snapshot. */
  resolveRankingReview(ownerId: string, rankingRunId: string): Promise<boolean>;
  findSimilarOutcomes(query: SimilarOutcomeQuery): Promise<SimilarTaskOutcome[]>;
  rankingRunBelongsToUser(rankingRunId: string, ownerId: string): Promise<boolean>;
  latestRankingState(ownerId: string): Promise<StoredRankingState | undefined>;
  archiveLatestRankingState(ownerId: string): Promise<boolean>;
  enqueueRankingTask(request: QueueRankingRequest): Promise<QueuedRankingTask>;
  listRankingTasks(ownerId: string): Promise<QueuedRankingTask[]>;
  /** Repairs legacy pending tasks only when an exact persisted run exists. */
  reconcilePendingRankingTasks(ownerId: string): Promise<number>;
  /** Renames one owned conversation across queue and persisted ranking history. */
  renameConversation(
    ownerId: string,
    currentConversationId: string,
    nextConversationId: string,
  ): Promise<boolean>;
  claimRankingTasks(
    ownerId: string,
    limit: number,
    options?: { leaseDurationMs?: number },
  ): Promise<QueuedRankingClaim[]>;
  completeRankingTask(claim: QueuedRankingClaim, result: QueueRankingResult): Promise<boolean>;
  completePendingRankingTask(
    ownerId: string,
    task: QueuedTaskReference,
    result: QueueRankingResult,
  ): Promise<boolean>;
  failRankingTask(claim: QueuedRankingClaim, message: string): Promise<boolean>;
  retryRankingTask(ownerId: string, taskId: string): Promise<boolean>;
}
