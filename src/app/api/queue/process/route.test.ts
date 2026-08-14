/** @file Request-boundary tests for one bounded conversational queue worker pass. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { processQueuedTasks, rankConversation, repository } = vi.hoisted(() => ({
  processQueuedTasks: vi.fn(),
  rankConversation: vi.fn(),
  repository: { listRankingTasks: vi.fn() },
}));

vi.mock("@/lib/queue/processor", () => ({ processQueuedTasks }));
vi.mock("@/lib/persistence/sqlite", () => ({ createSQLiteRepository: () => repository }));
vi.mock("@/app/api/rank/route", () => ({ POST: rankConversation }));

import { POST } from "./route";

describe("POST /api/queue/process", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs a bounded pass and returns the updated owner-scoped queue", async () => {
    processQueuedTasks.mockResolvedValue([{ taskId: "task-1", revision: 1, state: "decided" }]);
    repository.listRankingTasks.mockResolvedValue([{ id: "task-1", state: "decided" }]);
    const response = await POST(new Request("http://localhost/api/queue/process", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": "00000000-0000-4000-8000-000000000001",
      },
      body: JSON.stringify({ limit: 3 }),
    }));

    expect(response.status).toBe(200);
    expect(processQueuedTasks).toHaveBeenCalledWith(
      repository,
      "00000000-0000-4000-8000-000000000001",
      expect.any(Function),
      { limit: 3 },
    );
    expect(await response.json()).toEqual({
      processed: [{ taskId: "task-1", revision: 1, state: "decided" }],
      tasks: [{ id: "task-1", state: "decided" }],
    });
  });

  it("passes the safe provider message into the queue processor", async () => {
    rankConversation.mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "provider_rate_limited",
        message: "The analysis provider's rate limit or capacity limit was reached.",
      },
    }), { status: 429 }));
    repository.listRankingTasks.mockResolvedValue([]);
    processQueuedTasks.mockImplementation(async (_repository, _ownerId, rank) => {
      await expect(rank({
        provider: "api",
        conversation: {
          conversationId: "conversation-1",
          userId: "user-1",
          messages: [],
          acceptedOutcomes: [],
        },
      })).rejects.toThrow(/rate limit or capacity limit/i);
      return [];
    });

    const response = await POST(new Request("http://localhost/api/queue/process", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": "00000000-0000-4000-8000-000000000001",
      },
      body: JSON.stringify({ limit: 1 }),
    }));

    expect(response.status).toBe(200);
  });
});
