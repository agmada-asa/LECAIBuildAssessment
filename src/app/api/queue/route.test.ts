/** @file Request-boundary tests for queue inspection, enqueueing, and retry. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { repository } = vi.hoisted(() => ({
  repository: {
    enqueueRankingTask: vi.fn(),
    listRankingTasks: vi.fn(),
    reconcilePendingRankingTasks: vi.fn(),
    renameConversation: vi.fn(),
    retryRankingTask: vi.fn(),
  },
}));

vi.mock("@/lib/persistence/sqlite", () => ({
  createSQLiteRepository: () => repository,
}));

import { GET, PATCH, POST } from "./route";

const ownerId = "00000000-0000-4000-8000-000000000001";
const conversation = {
  conversationId: "conversation-1",
  userId: "imported-user",
  messages: [{ id: "M1", text: "Write the proposal", timestamp: "2026-08-14T09:00:00.000Z" }],
  acceptedOutcomes: [],
};

function request(method: string, body?: unknown, includeOwner = true): Request {
  return new Request("http://localhost/api/queue", {
    method,
    headers: {
      "content-type": "application/json",
      ...(includeOwner ? { "x-device-id": ownerId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/queue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enqueues a validated snapshot under the device owner without replacing imported identity", async () => {
    repository.enqueueRankingTask.mockResolvedValue({ id: "task-1", state: "pending" });
    const response = await POST(request("POST", { provider: "demo", conversation }));

    expect(response.status).toBe(202);
    expect(repository.enqueueRankingTask).toHaveBeenCalledWith({
      ownerId,
      provider: "demo",
      conversation,
    });
  });

  it("lists only tasks belonging to the supplied device owner", async () => {
    repository.reconcilePendingRankingTasks.mockResolvedValue(1);
    repository.listRankingTasks.mockResolvedValue([{ id: "task-1" }]);
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tasks: [{ id: "task-1" }] });
    expect(repository.reconcilePendingRankingTasks).toHaveBeenCalledWith(ownerId);
    expect(repository.listRankingTasks).toHaveBeenCalledWith(ownerId);
  });

  it("retries an owned failed task and rejects missing ownership", async () => {
    repository.retryRankingTask.mockResolvedValue(true);
    expect((await PATCH(request("PATCH", { taskId: "task-1" }))).status).toBe(200);
    expect(repository.retryRankingTask).toHaveBeenCalledWith(ownerId, "task-1");
    expect((await GET(request("GET", undefined, false))).status).toBe(401);
  });

  it("renames an owned conversation instead of treating it as a retry", async () => {
    repository.renameConversation.mockResolvedValue(true);
    const response = await PATCH(request("PATCH", {
      currentConversationId: "conversation-1",
      nextConversationId: "quarterly-review",
    }));

    expect(response.status).toBe(200);
    expect(repository.renameConversation).toHaveBeenCalledWith(
      ownerId,
      "conversation-1",
      "quarterly-review",
    );
    expect(repository.retryRankingTask).not.toHaveBeenCalled();
  });
});
