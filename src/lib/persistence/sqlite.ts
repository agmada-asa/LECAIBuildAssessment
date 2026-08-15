/** @file Durable server-side SQLite repository for device-scoped ranking state. */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { cosineSimilarity } from "@/lib/embeddings/similarity";
import { DEFAULT_WEIGHTS } from "@/lib/ranking/policy";
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
  StoredRankingState,
  StoredTaskOutcome,
} from "./types";

type RunRow = { id: string; conversation_id: string; payload: string; state: string };
type OutcomeRow = { id?: string; payload: string };
type QueueRow = {
  id: string;
  external_id: string;
  revision: number;
  state: string;
  attempts: number;
  request_payload: string;
  result_payload: string | null;
  error_message: string | null;
  lease_token: string | null;
  created_at: string;
  updated_at: string;
};

/** Converts a storage row into the queue's immutable public snapshot. */
function queueTaskFromRow(row: QueueRow): QueuedRankingTask {
  return {
    id: row.id,
    externalConversationId: row.external_id,
    revision: row.revision,
    state: row.state as QueuedRankingTask["state"],
    attempts: row.attempts,
    request: JSON.parse(row.request_payload) as QueueRankingRequest,
    result: row.result_payload
      ? (JSON.parse(row.result_payload) as QueueRankingResult)
      : undefined,
    error: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Stores complete ranking snapshots and reusable outcomes in one local database. */
export class SQLiteRankingRepository implements RankingRepository {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, external_id TEXT NOT NULL,
        payload TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(user_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS ranking_runs (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL,
        created_at TEXT NOT NULL, archived_at TEXT, UNIQUE(conversation_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS task_outcomes (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, domain_name TEXT,
        embedding_model TEXT NOT NULL, embedding_version TEXT NOT NULL,
        payload TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ranking_runs_latest_idx ON ranking_runs(conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS outcomes_lookup_idx ON task_outcomes(user_id, domain_name, embedding_model, embedding_version);
      CREATE TABLE IF NOT EXISTS queue_tasks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, external_id TEXT NOT NULL,
        revision INTEGER NOT NULL, request_hash TEXT NOT NULL, state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, request_payload TEXT NOT NULL,
        result_payload TEXT, error_message TEXT, lease_token TEXT, lease_expires_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(user_id, external_id)
      );
      CREATE INDEX IF NOT EXISTS queue_claim_idx ON queue_tasks(user_id, state, updated_at);
    `);
    const runColumns = this.database.prepare("PRAGMA table_info(ranking_runs)").all() as { name: string }[];
    if (!runColumns.some((column) => column.name === "archived_at")) {
      this.database.exec("ALTER TABLE ranking_runs ADD COLUMN archived_at TEXT;");
    }
  }

  /** Upserts the conversation snapshot and inserts an idempotent ranking run. */
  async persistRankingRun(run: PersistedRankingRun): Promise<PersistedRunReference> {
    const now = new Date().toISOString();
    const existingConversation = this.database
      .prepare("SELECT id FROM conversations WHERE user_id = ? AND external_id = ?")
      .get(run.ownerId, run.conversation.conversationId) as { id: string } | undefined;
    const conversationId = existingConversation?.id ?? randomUUID();
    this.database.prepare(`
      INSERT INTO conversations (id, user_id, external_id, payload, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, external_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(conversationId, run.ownerId, run.conversation.conversationId, JSON.stringify(run.conversation), now);

    const existing = this.database.prepare(
      "SELECT id, conversation_id, state FROM ranking_runs WHERE conversation_id = ? AND idempotency_key = ?",
    ).get(conversationId, run.idempotencyKey) as Omit<RunRow, "payload"> | undefined;
    if (existing) {
      this.database.prepare("UPDATE ranking_runs SET archived_at = NULL WHERE id = ?").run(existing.id);
      return { id: existing.id, conversationId: existing.conversation_id, state: existing.state as PersistedRunReference["state"], duplicate: true };
    }
    const id = randomUUID();
    const state = run.result.uncertain ? "human_review" : "decided";
    this.database.prepare(
      "INSERT INTO ranking_runs (id, conversation_id, idempotency_key, state, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, conversationId, run.idempotencyKey, state, JSON.stringify(run), now);
    return { id, conversationId, state, duplicate: false };
  }

  /** Atomically retains one active accepted decision per source ranking run. */
  async storeOutcome(outcome: StoredTaskOutcome): Promise<void> {
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (outcome.accepted && outcome.sourceRankingRunId) {
        const rows = this.database.prepare(
          "SELECT id, payload FROM task_outcomes WHERE user_id = ?",
        ).all(outcome.ownerId) as Required<OutcomeRow>[];
        rows.forEach((row) => {
          const existing = JSON.parse(row.payload) as StoredTaskOutcome;
          if (
            existing.id !== outcome.id &&
            existing.accepted &&
            existing.sourceRankingRunId === outcome.sourceRankingRunId
          ) {
            existing.accepted = false;
            this.database.prepare(
              "UPDATE task_outcomes SET payload = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            ).run(JSON.stringify(existing), now, row.id, outcome.ownerId);
          }
        });
      }
      this.database.prepare(`
        INSERT INTO task_outcomes (id, user_id, domain_name, embedding_model, embedding_version, payload, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `).run(
        outcome.id,
        outcome.ownerId,
        outcome.domainName ?? null,
        outcome.embeddingModel,
        outcome.embeddingVersion,
        JSON.stringify(outcome),
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Atomically resolves an owned review run and the queue result that names it. */
  async resolveRankingReview(ownerId: string, rankingRunId: string): Promise<boolean> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const ownedRun = this.database.prepare(`
        SELECT r.id FROM ranking_runs r
        JOIN conversations c ON c.id = r.conversation_id
        WHERE r.id = ? AND c.user_id = ?
      `).get(rankingRunId, ownerId);
      if (!ownedRun) {
        this.database.exec("ROLLBACK");
        return false;
      }

      this.database.prepare("UPDATE ranking_runs SET state = 'decided' WHERE id = ?")
        .run(rankingRunId);
      const reviewRows = this.database.prepare(`
        SELECT id, result_payload FROM queue_tasks
        WHERE user_id = ? AND state = 'human_review' AND result_payload IS NOT NULL
      `).all(ownerId) as Array<{ id: string; result_payload: string }>;
      const now = new Date().toISOString();
      for (const row of reviewRows) {
        const result = JSON.parse(row.result_payload) as QueueRankingResult;
        if (result.persistence.rankingRunId !== rankingRunId) continue;
        this.database.prepare(`
          UPDATE queue_tasks SET state = 'decided', updated_at = ?
          WHERE id = ? AND user_id = ? AND state = 'human_review'
        `).run(now, row.id, ownerId);
      }
      this.database.exec("COMMIT");
      return true;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Filters device-owned outcomes and ranks them with cosine similarity in process. */
  async findSimilarOutcomes(query: SimilarOutcomeQuery): Promise<SimilarTaskOutcome[]> {
    const rows = this.database.prepare(`
      SELECT payload FROM task_outcomes
      WHERE user_id = ? AND embedding_model = ? AND embedding_version = ?
      AND ((? IS NULL AND domain_name IS NULL) OR domain_name = ?)
    `).all(query.ownerId, query.embeddingModel, query.embeddingVersion, query.domainName ?? null, query.domainName ?? null) as OutcomeRow[];
    return rows
      .map(({ payload }) => JSON.parse(payload) as StoredTaskOutcome)
      .filter((outcome) => outcome.userId === query.userId && outcome.accepted)
      .map((outcome) => ({ ...outcome, similarity: cosineSimilarity(query.embedding, outcome.embedding) }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, query.limit);
  }

  /** Loads an exact run only when it belongs to the requesting browser profile. */
  async rankingRunForOwner(
    rankingRunId: string,
    ownerId: string,
  ): Promise<PersistedRankingRun | undefined> {
    const row = this.database.prepare(`
      SELECT r.payload FROM ranking_runs r JOIN conversations c ON c.id = r.conversation_id
      WHERE r.id = ? AND c.user_id = ?
    `).get(rankingRunId, ownerId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as PersistedRankingRun : undefined;
  }

  /** Returns the newest complete snapshot owned by a browser profile. */
  async latestRankingState(ownerId: string): Promise<StoredRankingState | undefined> {
    const row = this.database.prepare(`
      SELECT r.id, r.conversation_id, r.payload, r.state FROM ranking_runs r
      JOIN conversations c ON c.id = r.conversation_id WHERE c.user_id = ? AND r.archived_at IS NULL
      ORDER BY r.created_at DESC LIMIT 1
    `).get(ownerId) as RunRow | undefined;
    return row ? {
      reference: { id: row.id, conversationId: row.conversation_id, state: row.state as PersistedRunReference["state"], duplicate: false },
      run: JSON.parse(row.payload) as PersistedRankingRun,
    } : undefined;
  }

  /** Archives visible runs so reset cannot reveal an older snapshot on reload. */
  async archiveLatestRankingState(ownerId: string): Promise<boolean> {
    const result = this.database.prepare(`
      UPDATE ranking_runs SET archived_at = ? WHERE archived_at IS NULL AND conversation_id IN (
        SELECT id FROM conversations WHERE user_id = ?
      )
    `).run(new Date().toISOString(), ownerId);
    return result.changes > 0;
  }

  /** Upserts one conversation snapshot and schedules only changed or failed work. */
  async enqueueRankingTask(request: QueueRankingRequest): Promise<QueuedRankingTask> {
    const now = new Date().toISOString();
    let requestPayload = JSON.stringify(request);
    const requestHash = createHash("sha256").update(requestPayload).digest("hex");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database.prepare(
        "SELECT * FROM queue_tasks WHERE user_id = ? AND external_id = ?",
      ).get(request.ownerId, request.conversation.conversationId) as QueueRow & { request_hash: string } | undefined;
      if (!existing) {
        this.database.prepare(`
          INSERT INTO queue_tasks (
            id, user_id, external_id, revision, request_hash, state, request_payload, created_at, updated_at
          ) VALUES (?, ?, ?, 1, ?, 'pending', ?, ?, ?)
        `).run(randomUUID(), request.ownerId, request.conversation.conversationId, requestHash, requestPayload, now, now);
      } else if (existing.request_hash !== requestHash) {
        const priorResult = existing.result_payload
          ? (JSON.parse(existing.result_payload) as QueueRankingResult)
          : undefined;
        const resumedRequest = request.previousInput || !priorResult
          ? request
          : { ...request, previousInput: priorResult.input };
        requestPayload = JSON.stringify(resumedRequest);
        this.database.prepare(`
          UPDATE queue_tasks SET revision = revision + 1, request_hash = ?, state = 'pending',
            request_payload = ?, result_payload = NULL, error_message = NULL,
            lease_token = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE id = ?
        `).run(requestHash, requestPayload, now, existing.id);
      } else if (existing.state === "failed") {
        this.database.prepare(`
          UPDATE queue_tasks SET state = 'pending', error_message = NULL,
            lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?
        `).run(now, existing.id);
      }
      const row = this.database.prepare(
        "SELECT * FROM queue_tasks WHERE user_id = ? AND external_id = ?",
      ).get(request.ownerId, request.conversation.conversationId) as QueueRow;
      this.database.exec("COMMIT");
      return queueTaskFromRow(row);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Lists every task owned by one device, newest context first. */
  async listRankingTasks(ownerId: string): Promise<QueuedRankingTask[]> {
    const rows = this.database.prepare(
      "SELECT * FROM queue_tasks WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
    ).all(ownerId) as QueueRow[];
    return rows.map(queueTaskFromRow);
  }

  /** Loads one exact owner-scoped queue revision for server-side request binding. */
  async rankingTaskForOwner(
    ownerId: string,
    reference: Pick<QueuedRankingTask, "id" | "revision">,
  ): Promise<QueuedRankingTask | undefined> {
    const row = this.database.prepare(`
      SELECT * FROM queue_tasks WHERE id = ? AND user_id = ? AND revision = ?
    `).get(reference.id, ownerId, reference.revision) as QueueRow | undefined;
    return row ? queueTaskFromRow(row) : undefined;
  }

  /** Repairs legacy pending tasks only from exact owner-scoped persisted runs. */
  async reconcilePendingRankingTasks(ownerId: string): Promise<number> {
    const pendingRows = this.database.prepare(
      "SELECT * FROM queue_tasks WHERE user_id = ? AND state = 'pending'",
    ).all(ownerId) as QueueRow[];
    let reconciled = 0;
    for (const row of pendingRows) {
      const task = queueTaskFromRow(row);
      const idempotencyKey = rankingRunIdempotencyKey({
        provider: task.request.provider,
        conversation: task.request.conversation,
        weights: task.request.weights ?? DEFAULT_WEIGHTS,
      });
      const runRow = this.database.prepare(`
        SELECT r.id, r.conversation_id, r.payload, r.state FROM ranking_runs r
        JOIN conversations c ON c.id = r.conversation_id
        WHERE c.user_id = ? AND c.external_id = ? AND r.idempotency_key = ?
        ORDER BY r.created_at DESC LIMIT 1
      `).get(
        ownerId,
        task.externalConversationId,
        idempotencyKey,
      ) as RunRow | undefined;
      if (!runRow) continue;
      const reference: PersistedRunReference = {
        id: runRow.id,
        conversationId: runRow.conversation_id,
        state: runRow.state as PersistedRunReference["state"],
        duplicate: true,
      };
      const completed = await this.completePendingRankingTask(
        ownerId,
        { id: task.id, revision: task.revision },
        queueResultFromPersistedRun(
          JSON.parse(runRow.payload) as PersistedRankingRun,
          reference,
        ),
      );
      if (completed) reconciled += 1;
    }
    return reconciled;
  }

  /** Atomically renames queue, conversation, and stored run payload snapshots. */
  async renameConversation(
    ownerId: string,
    currentConversationId: string,
    nextConversationId: string,
  ): Promise<boolean> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const queueRow = this.database.prepare(
        "SELECT * FROM queue_tasks WHERE user_id = ? AND external_id = ?",
      ).get(ownerId, currentConversationId) as QueueRow | undefined;
      const conversationRow = this.database.prepare(
        "SELECT id, payload FROM conversations WHERE user_id = ? AND external_id = ?",
      ).get(ownerId, currentConversationId) as { id: string; payload: string } | undefined;
      const targetExists = Boolean(
        this.database.prepare(
          "SELECT 1 FROM queue_tasks WHERE user_id = ? AND external_id = ?",
        ).get(ownerId, nextConversationId) ??
        this.database.prepare(
          "SELECT 1 FROM conversations WHERE user_id = ? AND external_id = ?",
        ).get(ownerId, nextConversationId),
      );
      if ((!queueRow && !conversationRow) || targetExists) {
        this.database.exec("ROLLBACK");
        return false;
      }

      const now = new Date().toISOString();
      if (queueRow) {
        const request = JSON.parse(queueRow.request_payload) as QueueRankingRequest;
        request.conversation.conversationId = nextConversationId;
        const requestPayload = JSON.stringify(request);
        const requestHash = createHash("sha256").update(requestPayload).digest("hex");
        this.database.prepare(`
          UPDATE queue_tasks SET external_id = ?, request_hash = ?, request_payload = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `).run(nextConversationId, requestHash, requestPayload, now, queueRow.id, ownerId);
      }

      if (conversationRow) {
        const conversation = JSON.parse(conversationRow.payload) as PersistedRankingRun["conversation"];
        conversation.conversationId = nextConversationId;
        this.database.prepare(`
          UPDATE conversations SET external_id = ?, payload = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `).run(nextConversationId, JSON.stringify(conversation), now, conversationRow.id, ownerId);

        const runRows = this.database.prepare(
          "SELECT id, payload FROM ranking_runs WHERE conversation_id = ?",
        ).all(conversationRow.id) as Array<{ id: string; payload: string }>;
        for (const runRow of runRows) {
          const run = JSON.parse(runRow.payload) as PersistedRankingRun;
          run.conversation.conversationId = nextConversationId;
          this.database.prepare("UPDATE ranking_runs SET payload = ? WHERE id = ?")
            .run(JSON.stringify(run), runRow.id);
        }
      }

      this.database.exec("COMMIT");
      return true;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Atomically leases a bounded batch, including work abandoned after restart. */
  async claimRankingTasks(
    ownerId: string,
    limit: number,
    options: { leaseDurationMs?: number } = {},
  ): Promise<QueuedRankingClaim[]> {
    const boundedLimit = Math.max(1, Math.min(25, Math.floor(limit)));
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + (options.leaseDurationMs ?? 300_000)).toISOString();
    const claims: QueuedRankingClaim[] = [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.database.prepare(`
        SELECT * FROM queue_tasks WHERE user_id = ?
          AND (state = 'pending' OR (state = 'processing' AND lease_expires_at <= ?))
        ORDER BY updated_at ASC, id ASC LIMIT ?
      `).all(ownerId, now.toISOString(), boundedLimit) as QueueRow[];
      for (const row of rows) {
        const leaseToken = randomUUID();
        this.database.prepare(`
          UPDATE queue_tasks SET state = 'processing', attempts = attempts + 1,
            lease_token = ?, lease_expires_at = ?, updated_at = ? WHERE id = ?
        `).run(leaseToken, leaseExpiresAt, now.toISOString(), row.id);
        claims.push({
          ...queueTaskFromRow({
            ...row,
            state: "processing",
            attempts: row.attempts + 1,
            updated_at: now.toISOString(),
          }),
          leaseToken,
        });
      }
      this.database.exec("COMMIT");
      return claims;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Commits a result only when its lease still targets the current revision. */
  async completeRankingTask(claim: QueuedRankingClaim, result: QueueRankingResult): Promise<boolean> {
    const state = result.result.uncertain ? "human_review" : "decided";
    const updated = this.database.prepare(`
      UPDATE queue_tasks SET state = ?, result_payload = ?, error_message = NULL,
        lease_token = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND user_id = ? AND revision = ? AND state = 'processing' AND lease_token = ?
    `).run(state, JSON.stringify(result), new Date().toISOString(), claim.id, claim.request.ownerId, claim.revision, claim.leaseToken);
    return updated.changes > 0;
  }

  /** Commits a synchronous result only when the named queued revision is pending. */
  async completePendingRankingTask(
    ownerId: string,
    reference: Pick<QueuedRankingTask, "id" | "revision">,
    result: QueueRankingResult,
  ): Promise<boolean> {
    const state = result.result.uncertain ? "human_review" : "decided";
    const updated = this.database.prepare(`
      UPDATE queue_tasks SET state = ?, result_payload = ?, error_message = NULL,
        lease_token = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND user_id = ? AND revision = ? AND state = 'pending'
    `).run(
      state,
      JSON.stringify(result),
      new Date().toISOString(),
      reference.id,
      ownerId,
      reference.revision,
    );
    return updated.changes > 0;
  }

  /** Records a bounded non-sensitive failure only for the active lease. */
  async failRankingTask(claim: QueuedRankingClaim, message: string): Promise<boolean> {
    const updated = this.database.prepare(`
      UPDATE queue_tasks SET state = 'failed', error_message = ?,
        lease_token = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND user_id = ? AND revision = ? AND state = 'processing' AND lease_token = ?
    `).run(message.slice(0, 500), new Date().toISOString(), claim.id, claim.request.ownerId, claim.revision, claim.leaseToken);
    return updated.changes > 0;
  }

  /** Makes a failed task eligible for a deliberate retry without duplicating it. */
  async retryRankingTask(ownerId: string, taskId: string): Promise<boolean> {
    const updated = this.database.prepare(`
      UPDATE queue_tasks SET state = 'pending', error_message = NULL, updated_at = ?
      WHERE id = ? AND user_id = ? AND state = 'failed'
    `).run(new Date().toISOString(), taskId, ownerId);
    return updated.changes > 0;
  }

  /** Releases the file handle, primarily for isolated integration tests. */
  close(): void {
    this.database.close();
  }
}

let singleton: SQLiteRankingRepository | undefined;

/** Returns the process-wide repository using the configured or default data file. */
export function createSQLiteRepository(environment: NodeJS.ProcessEnv = process.env): SQLiteRankingRepository {
  if (!singleton) {
    singleton = new SQLiteRankingRepository(environment.SQLITE_DATABASE_PATH ?? join(process.cwd(), "data", "resolve.sqlite"));
  }
  return singleton;
}
