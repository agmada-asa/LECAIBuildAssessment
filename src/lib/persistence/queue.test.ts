/** @file Integration coverage for the durable conversational task queue. */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { processQueuedTasks } from "@/lib/queue/processor";
import { SQLiteRankingRepository } from "./sqlite";
import type { QueueRankingRequest, QueueRankingResult } from "./types";

const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";

function request(
  conversationId: string,
  userId = userA,
  messages = [{ id: "M1", text: "Write the proposal", timestamp: "2026-08-14T09:00:00.000Z" }],
): QueueRankingRequest {
  return {
    ownerId: userId,
    provider: "demo",
    conversation: { conversationId, userId, messages, acceptedOutcomes: [] },
  };
}

function rankingResult(uncertain = false): QueueRankingResult {
  return {
    provider: { id: "demo", name: "Deterministic fallback", fallback: true, notes: "Test result." },
    input: { interpretations: [], constraintRules: [], history: [] },
    result: { uncertain, ranking: [] } as unknown as QueueRankingResult["result"],
    persistence: { enabled: true, identified: true },
  };
}

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), "resolve-queue-")), "queue.sqlite");
}

describe("SQLite conversational task queue", () => {
  it("holds multiple tasks and isolates queue inspection and claims by user", async () => {
    const repository = new SQLiteRankingRepository(databasePath());
    await repository.enqueueRankingTask(request("conversation-a"));
    await repository.enqueueRankingTask(request("conversation-b"));
    await repository.enqueueRankingTask(request("private", userB));

    expect(await repository.listRankingTasks(userA)).toHaveLength(2);
    expect(await repository.listRankingTasks(userB)).toEqual([
      expect.objectContaining({ externalConversationId: "private", state: "pending" }),
    ]);
    expect(await repository.claimRankingTasks(userA, 10)).toHaveLength(2);
    expect(await repository.claimRankingTasks(userB, 10)).toHaveLength(1);
    repository.close();
  });

  it("does not let an in-flight run overwrite appended conversation context", async () => {
    const repository = new SQLiteRankingRepository(databasePath());
    const initial = await repository.enqueueRankingTask(request("conversation-a"));
    const [claim] = await repository.claimRankingTasks(userA, 1);
    const appended = await repository.enqueueRankingTask(
      request("conversation-a", userA, [
        ...initial.request.conversation.messages,
        { id: "M2", text: "No dashboard yet", timestamp: "2026-08-14T09:01:00.000Z" },
      ]),
    );

    expect(appended).toMatchObject({ revision: 2, state: "pending" });
    expect(await repository.enqueueRankingTask(
      request("conversation-a", userA, appended.request.conversation.messages),
    )).toMatchObject({ id: appended.id, revision: 2, state: "pending" });
    expect(await repository.completeRankingTask(claim, rankingResult())).toBe(false);

    const [currentClaim] = await repository.claimRankingTasks(userA, 1);
    expect(currentClaim.revision).toBe(2);
    expect(await repository.completeRankingTask(currentClaim, rankingResult(true))).toBe(true);
    expect(await repository.listRankingTasks(userA)).toEqual([
      expect.objectContaining({
        revision: 2,
        state: "human_review",
        result: expect.objectContaining({ result: expect.objectContaining({ uncertain: true }) }),
      }),
    ]);
    repository.close();
  });

  it("supports an explicit retry after failure without duplicating the task", async () => {
    const repository = new SQLiteRankingRepository(databasePath());
    const queued = await repository.enqueueRankingTask(request("conversation-a"));
    const rank = vi.fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(rankingResult());

    await processQueuedTasks(repository, userA, rank, { limit: 1 });
    expect(await repository.listRankingTasks(userA)).toEqual([
      expect.objectContaining({ id: queued.id, state: "failed", attempts: 1 }),
    ]);

    expect(await repository.retryRankingTask(userA, queued.id)).toBe(true);
    await processQueuedTasks(repository, userA, rank, { limit: 1 });
    expect(await repository.listRankingTasks(userA)).toEqual([
      expect.objectContaining({ id: queued.id, state: "decided", attempts: 2 }),
    ]);
    expect(rank).toHaveBeenCalledTimes(2);
    repository.close();
  });

  it("recovers an expired processing lease after the repository restarts", async () => {
    const path = databasePath();
    const first = new SQLiteRankingRepository(path);
    await first.enqueueRankingTask(request("conversation-a"));
    expect(await first.claimRankingTasks(userA, 1, { leaseDurationMs: 0 })).toHaveLength(1);
    first.close();

    const reopened = new SQLiteRankingRepository(path);
    const rank = vi.fn().mockResolvedValue(rankingResult());
    const processed = await processQueuedTasks(reopened, userA, rank, {
      limit: 1,
      leaseDurationMs: 1_000,
    });

    expect(processed).toEqual([expect.objectContaining({ state: "decided" })]);
    expect(await reopened.listRankingTasks(userA)).toEqual([
      expect.objectContaining({ state: "decided", attempts: 2 }),
    ]);
    reopened.close();
  });
});
