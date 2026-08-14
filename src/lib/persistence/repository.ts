/**
 * @file Deterministic in-memory implementation of the ranking repository.
 *
 * It supports contract tests and local development without pretending to be
 * durable. The application selects SQLite for normal local operation.
 */

import { cosineSimilarity } from "@/lib/embeddings/similarity";
import { DEFAULT_WEIGHTS } from "@/lib/ranking/scenarios";
import {
  queueResultFromPersistedRun,
  rankingRunIdempotencyKey,
} from "./queue-reconciliation";
import type {
  PersistedRankingRun,
  PersistedRunReference,
  QueueRankingRequest,
  QueueRankingResult,
  QueuedRankingClaim,
  QueuedRankingTask,
  RankingRepository,
  SimilarOutcomeQuery,
  SimilarTaskOutcome,
  StoredTaskOutcome,
  StoredRankingState,
} from "./types";

type StoredMessage = {
  sourceId: string;
  position: number;
  text: string;
};

type StoredConversation = {
  id: string;
  ownerId: string;
  userId: string;
  externalId: string;
  messages: StoredMessage[];
};

/** In-process repository with the same isolation and idempotency semantics. */
export class InMemoryRankingRepository implements RankingRepository {
  private readonly conversations = new Map<string, StoredConversation>();
  private readonly runs = new Map<string, PersistedRunReference>();
  private readonly runPayloads = new Map<string, PersistedRankingRun>();
  private readonly outcomes = new Map<string, StoredTaskOutcome>();
  private readonly archivedRuns = new Set<string>();
  private readonly queue = new Map<string, QueuedRankingTask>();
  private readonly queueLeases = new Map<string, { token: string; expiresAt: number }>();
  private nextId = 1;

  /** Upserts conversation/messages and de-duplicates the ranking job key. */
  async persistRankingRun(
    run: PersistedRankingRun,
  ): Promise<PersistedRunReference> {
    const conversationKey = `${run.ownerId}:${run.conversation.conversationId}`;
    let conversation = this.conversations.get(conversationKey);
    if (!conversation) {
      conversation = {
        id: `conversation-${this.nextId++}`,
        ownerId: run.ownerId,
        userId: run.conversation.userId,
        externalId: run.conversation.conversationId,
        messages: [],
      };
      this.conversations.set(conversationKey, conversation);
    }
    conversation.messages = run.conversation.messages.map((message, position) => ({
      sourceId: message.id,
      position,
      text: message.text,
    }));

    const runKey = `${conversation.id}:${run.idempotencyKey}`;
    const existing = this.runs.get(runKey);
    if (existing) {
      this.archivedRuns.delete(existing.id);
      return { ...existing, duplicate: true };
    }
    const reference: PersistedRunReference = {
      id: `run-${this.nextId++}`,
      conversationId: conversation.id,
      state: run.result.uncertain ? "human_review" : "decided",
      duplicate: false,
    };
    this.runs.set(runKey, reference);
    this.runPayloads.set(reference.id, structuredClone(run));
    return reference;
  }

  /** Inserts or replaces an outcome by stable outcome ID. */
  async storeOutcome(outcome: StoredTaskOutcome): Promise<void> {
    this.outcomes.set(outcome.id, { ...outcome, embedding: [...outcome.embedding] });
  }

  /** Marks an owned reviewed run and only its corresponding queued result decided. */
  async resolveRankingReview(ownerId: string, rankingRunId: string): Promise<boolean> {
    const reference = [...this.runs.values()].find((run) => run.id === rankingRunId);
    const conversation = reference
      ? [...this.conversations.values()].find(
          (item) => item.id === reference.conversationId && item.ownerId === ownerId,
        )
      : undefined;
    if (!reference || !conversation) return false;

    reference.state = "decided";
    const task = [...this.queue.values()].find(
      (item) =>
        item.request.ownerId === ownerId &&
        item.result?.persistence.rankingRunId === rankingRunId,
    );
    if (task?.state === "human_review") {
      task.state = "decided";
      task.updatedAt = new Date().toISOString();
    }
    return true;
  }

  /** Applies strict user/domain/model filters before cosine ordering. */
  async findSimilarOutcomes(
    query: SimilarOutcomeQuery,
  ): Promise<SimilarTaskOutcome[]> {
    return [...this.outcomes.values()]
      .filter(
        (outcome) =>
          outcome.userId === query.userId &&
          outcome.ownerId === query.ownerId &&
          outcome.accepted &&
          outcome.domainName === query.domainName &&
          outcome.embeddingModel === query.embeddingModel &&
          outcome.embeddingVersion === query.embeddingVersion,
      )
      .map((outcome) => ({
        ...outcome,
        similarity: cosineSimilarity(query.embedding, outcome.embedding),
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, query.limit);
  }

  /** Confirms ownership through the run's stored conversation. */
  async rankingRunBelongsToUser(
    rankingRunId: string,
    ownerId: string,
  ): Promise<boolean> {
    const run = [...this.runs.values()].find((item) => item.id === rankingRunId);
    const conversation = run
      ? [...this.conversations.values()].find(
          (item) => item.id === run.conversationId,
        )
      : undefined;
    return conversation?.ownerId === ownerId;
  }

  /** Returns the most recently inserted run for one user. */
  async latestRankingState(ownerId: string): Promise<StoredRankingState | undefined> {
    const reference = [...this.runs.values()].reverse().find((run) => {
      const conversation = [...this.conversations.values()].find((item) => item.id === run.conversationId);
      return conversation?.ownerId === ownerId && !this.archivedRuns.has(run.id);
    });
    const run = reference ? this.runPayloads.get(reference.id) : undefined;
    return reference && run ? { reference: { ...reference }, run: structuredClone(run) } : undefined;
  }

  /** Archives visible runs without deleting their audit records. */
  async archiveLatestRankingState(ownerId: string): Promise<boolean> {
    const ownedRunIds = [...this.runs.values()]
      .filter((reference) => {
        const conversation = [...this.conversations.values()].find(
          (item) => item.id === reference.conversationId,
        );
        return conversation?.ownerId === ownerId && !this.archivedRuns.has(reference.id);
      })
      .map((reference) => reference.id);
    ownedRunIds.forEach((id) => this.archivedRuns.add(id));
    return ownedRunIds.length > 0;
  }

  /** Stores changed queue context once per owner and external conversation. */
  async enqueueRankingTask(request: QueueRankingRequest): Promise<QueuedRankingTask> {
    const key = `${request.ownerId}:${request.conversation.conversationId}`;
    const existing = this.queue.get(key);
    const now = new Date().toISOString();
    if (!existing) {
      const created: QueuedRankingTask = {
        id: `queue-${this.nextId++}`,
        externalConversationId: request.conversation.conversationId,
        revision: 1,
        state: "pending",
        attempts: 0,
        request: structuredClone(request),
        createdAt: now,
        updatedAt: now,
      };
      this.queue.set(key, created);
      return structuredClone(created);
    }
    if (JSON.stringify(existing.request) !== JSON.stringify(request)) {
      const resumed = request.previousInput || !existing.result
        ? request
        : { ...request, previousInput: existing.result.input };
      Object.assign(existing, {
        revision: existing.revision + 1,
        state: "pending" as const,
        request: structuredClone(resumed),
        result: undefined,
        error: undefined,
        updatedAt: now,
      });
      this.queueLeases.delete(existing.id);
    } else if (existing.state === "failed") {
      existing.state = "pending";
      existing.error = undefined;
      existing.updatedAt = now;
    }
    return structuredClone(existing);
  }

  /** Returns isolated copies of one owner's queue. */
  async listRankingTasks(ownerId: string): Promise<QueuedRankingTask[]> {
    return [...this.queue.values()]
      .filter((task) => task.request.ownerId === ownerId)
      .map((task) => structuredClone(task));
  }

  /** Repairs pre-fix pending tasks from exact owner-scoped persisted runs. */
  async reconcilePendingRankingTasks(ownerId: string): Promise<number> {
    let reconciled = 0;
    for (const task of this.queue.values()) {
      if (task.request.ownerId !== ownerId || task.state !== "pending") continue;
      const idempotencyKey = rankingRunIdempotencyKey({
        provider: task.request.provider,
        conversation: task.request.conversation,
        weights: task.request.weights ?? DEFAULT_WEIGHTS,
      });
      const stored = [...this.runPayloads.entries()].find(
        ([, run]) => run.ownerId === ownerId && run.idempotencyKey === idempotencyKey,
      );
      if (!stored) continue;
      const [runId, run] = stored;
      const reference = [...this.runs.values()].find((item) => item.id === runId);
      if (!reference) continue;
      const completed = await this.completePendingRankingTask(
        ownerId,
        { id: task.id, revision: task.revision },
        queueResultFromPersistedRun(run, reference),
      );
      if (completed) reconciled += 1;
    }
    return reconciled;
  }

  /** Renames queue and stored run snapshots while retaining their stable IDs. */
  async renameConversation(
    ownerId: string,
    currentConversationId: string,
    nextConversationId: string,
  ): Promise<boolean> {
    const currentKey = `${ownerId}:${currentConversationId}`;
    const nextKey = `${ownerId}:${nextConversationId}`;
    const conversation = this.conversations.get(currentKey);
    const queuedTask = this.queue.get(currentKey);
    if ((!conversation && !queuedTask) || this.conversations.has(nextKey) || this.queue.has(nextKey)) {
      return false;
    }

    if (conversation) {
      this.conversations.delete(currentKey);
      conversation.externalId = nextConversationId;
      this.conversations.set(nextKey, conversation);
    }
    if (queuedTask) {
      this.queue.delete(currentKey);
      queuedTask.externalConversationId = nextConversationId;
      queuedTask.request.conversation.conversationId = nextConversationId;
      queuedTask.updatedAt = new Date().toISOString();
      this.queue.set(nextKey, queuedTask);
    }
    for (const run of this.runPayloads.values()) {
      if (run.ownerId === ownerId && run.conversation.conversationId === currentConversationId) {
        run.conversation.conversationId = nextConversationId;
      }
    }
    return true;
  }

  /** Leases pending or expired tasks for a bounded worker pass. */
  async claimRankingTasks(
    ownerId: string,
    limit: number,
    options: { leaseDurationMs?: number } = {},
  ): Promise<QueuedRankingClaim[]> {
    const now = Date.now();
    return [...this.queue.values()]
      .filter((task) => {
        const lease = this.queueLeases.get(task.id);
        return task.request.ownerId === ownerId &&
          (task.state === "pending" || (task.state === "processing" && Boolean(lease && lease.expiresAt <= now)));
      })
      .slice(0, Math.max(1, Math.min(25, Math.floor(limit))))
      .map((task) => {
        const token = `lease-${this.nextId++}`;
        task.state = "processing";
        task.attempts += 1;
        task.updatedAt = new Date(now).toISOString();
        this.queueLeases.set(task.id, { token, expiresAt: now + (options.leaseDurationMs ?? 300_000) });
        return { ...structuredClone(task), leaseToken: token };
      });
  }

  /** Applies a leased result only if no newer context replaced it. */
  async completeRankingTask(claim: QueuedRankingClaim, result: QueueRankingResult): Promise<boolean> {
    const task = [...this.queue.values()].find((item) => item.id === claim.id);
    const lease = this.queueLeases.get(claim.id);
    if (!task || task.revision !== claim.revision || lease?.token !== claim.leaseToken) return false;
    task.state = result.result.uncertain ? "human_review" : "decided";
    task.result = structuredClone(result);
    task.error = undefined;
    task.updatedAt = new Date().toISOString();
    this.queueLeases.delete(task.id);
    return true;
  }

  /** Commits a direct result only to the pending revision named by the client. */
  async completePendingRankingTask(
    ownerId: string,
    reference: Pick<QueuedRankingTask, "id" | "revision">,
    result: QueueRankingResult,
  ): Promise<boolean> {
    const task = [...this.queue.values()].find(
      (item) =>
        item.id === reference.id &&
        item.revision === reference.revision &&
        item.request.ownerId === ownerId &&
        item.state === "pending",
    );
    if (!task) return false;
    task.state = result.result.uncertain ? "human_review" : "decided";
    task.result = structuredClone(result);
    task.error = undefined;
    task.updatedAt = new Date().toISOString();
    return true;
  }

  /** Applies a leased failure only if no newer context replaced it. */
  async failRankingTask(claim: QueuedRankingClaim, message: string): Promise<boolean> {
    const task = [...this.queue.values()].find((item) => item.id === claim.id);
    const lease = this.queueLeases.get(claim.id);
    if (!task || task.revision !== claim.revision || lease?.token !== claim.leaseToken) return false;
    task.state = "failed";
    task.error = message.slice(0, 500);
    task.updatedAt = new Date().toISOString();
    this.queueLeases.delete(task.id);
    return true;
  }

  /** Makes one owned failed task eligible for another worker pass. */
  async retryRankingTask(ownerId: string, taskId: string): Promise<boolean> {
    const task = [...this.queue.values()].find(
      (item) => item.id === taskId && item.request.ownerId === ownerId,
    );
    if (!task || task.state !== "failed") return false;
    task.state = "pending";
    task.error = undefined;
    task.updatedAt = new Date().toISOString();
    return true;
  }

  /** Test-only view of a conversation without mutable collection references. */
  inspectConversation(id: string): StoredConversation | undefined {
    const found = [...this.conversations.values()].find((item) => item.id === id);
    return found
      ? { ...found, messages: found.messages.map((message) => ({ ...message })) }
      : undefined;
  }

  /** Test-only view used to assert job de-duplication. */
  inspectRuns(): PersistedRunReference[] {
    return [...this.runs.values()].map((run) => ({ ...run }));
  }
}
