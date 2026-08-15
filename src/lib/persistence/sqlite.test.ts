/** @file SQLite persistence integration tests using an isolated temporary database. */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SQLiteRankingRepository } from "./sqlite";
import type { PersistedRankingRun, StoredTaskOutcome } from "./types";

const run: PersistedRankingRun = {
  ownerId: "00000000-0000-4000-8000-000000000001",
  idempotencyKey: "request-1",
  provider: "demo",
  weights: { semantic: 0.3, constraints: 0.5, history: 0.2 },
  conversation: {
    conversationId: "conversation-1",
    userId: "00000000-0000-4000-8000-000000000001",
    messages: [{ id: "M1", text: "Keep this", timestamp: "2026-08-14T09:00:00.000Z" }],
    acceptedOutcomes: [],
  },
  input: { interpretations: [], constraintRules: [], history: [] },
  result: { uncertain: false } as PersistedRankingRun["result"],
};

/** Creates accepted history records for SQLite outcome replacement tests. */
function outcome(overrides: Partial<StoredTaskOutcome> = {}): StoredTaskOutcome {
  return {
    id: "outcome-a",
    ownerId: run.ownerId,
    userId: run.conversation.userId,
    domainName: "finance",
    sourceRankingRunId: "run-1",
    interpretationKey: "csv",
    title: "Export CSV",
    summary: "Send machine-readable finance rows.",
    semanticTerms: ["csv", "finance rows"],
    features: ["format:csv"],
    decision: "accepted",
    accepted: true,
    embedding: [1, 0, 0],
    embeddingModel: "test",
    embeddingVersion: "1",
    ...overrides,
  };
}

describe("SQLiteRankingRepository", () => {
  it("loads only the exact owner-scoped queue revision", async () => {
    const repository = new SQLiteRankingRepository(
      join(mkdtempSync(join(tmpdir(), "resolve-queue-")), "state.sqlite"),
    );
    const queued = await repository.enqueueRankingTask({
      ownerId: run.ownerId,
      provider: "demo",
      conversation: run.conversation,
    });

    expect(
      await repository.rankingTaskForOwner(run.ownerId, {
        id: queued.id,
        revision: queued.revision,
      }),
    ).toMatchObject({ id: queued.id, request: { ownerId: run.ownerId } });
    expect(
      await repository.rankingTaskForOwner(
        "00000000-0000-4000-8000-000000000002",
        { id: queued.id, revision: queued.revision },
      ),
    ).toBeUndefined();
    expect(
      await repository.rankingTaskForOwner(run.ownerId, {
        id: queued.id,
        revision: queued.revision + 1,
      }),
    ).toBeUndefined();
    repository.close();
  });

  it("survives repository recreation and isolates state by device", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "resolve-sqlite-")), "state.sqlite");
    const first = new SQLiteRankingRepository(path);
    const reference = await first.persistRankingRun(run);
    first.close();

    const reopened = new SQLiteRankingRepository(path);
    expect(await reopened.rankingRunForOwner(reference.id, run.ownerId)).toMatchObject({
      conversation: { conversationId: "conversation-1" },
    });
    expect(
      await reopened.rankingRunForOwner(
        reference.id,
        "00000000-0000-4000-8000-000000000002",
      ),
    ).toBeUndefined();
    expect(await reopened.latestRankingState(run.ownerId)).toMatchObject({
      reference: { id: reference.id },
      run: { conversation: { messages: [{ text: "Keep this" }] } },
    });
    expect(await reopened.latestRankingState("00000000-0000-4000-8000-000000000002")).toBeUndefined();

    expect(await reopened.archiveLatestRankingState(run.ownerId)).toBe(true);
    expect(await reopened.latestRankingState(run.ownerId)).toBeUndefined();
    reopened.close();
  });

  it("keeps only the latest accepted outcome active for one ranking run", async () => {
    const repository = new SQLiteRankingRepository(
      join(mkdtempSync(join(tmpdir(), "resolve-outcomes-")), "state.sqlite"),
    );
    await repository.storeOutcome(outcome({ id: "first-choice" }));
    await repository.storeOutcome(outcome({
      id: "revised-choice",
      interpretationKey: "slides",
      title: "Prepare slides",
    }));

    const matches = await repository.findSimilarOutcomes({
      ownerId: run.ownerId,
      userId: run.conversation.userId,
      domainName: "finance",
      embedding: [1, 0, 0],
      embeddingModel: "test",
      embeddingVersion: "1",
      limit: 5,
    });

    expect(matches.map((match) => match.id)).toEqual(["revised-choice"]);
    repository.close();
  });
});
