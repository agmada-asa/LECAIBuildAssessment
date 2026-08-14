/** @file SQLite persistence integration tests using an isolated temporary database. */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SQLiteRankingRepository } from "./sqlite";
import type { PersistedRankingRun } from "./types";

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

describe("SQLiteRankingRepository", () => {
  it("survives repository recreation and isolates state by device", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "resolve-sqlite-")), "state.sqlite");
    const first = new SQLiteRankingRepository(path);
    const reference = await first.persistRankingRun(run);
    first.close();

    const reopened = new SQLiteRankingRepository(path);
    expect(await reopened.latestRankingState(run.ownerId)).toMatchObject({
      reference: { id: reference.id },
      run: { conversation: { messages: [{ text: "Keep this" }] } },
    });
    expect(await reopened.latestRankingState("00000000-0000-4000-8000-000000000002")).toBeUndefined();

    expect(await reopened.archiveLatestRankingState(run.ownerId)).toBe(true);
    expect(await reopened.latestRankingState(run.ownerId)).toBeUndefined();
    reopened.close();
  });
});
