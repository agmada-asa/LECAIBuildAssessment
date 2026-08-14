/** @file Security and persistence tests for accepted/corrected outcome actions. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { repository } = vi.hoisted(() => ({
  repository: {
    rankingRunBelongsToUser: vi.fn(),
    storeOutcome: vi.fn(),
    resolveRankingReview: vi.fn(),
  },
}));

vi.mock("@/lib/persistence/sqlite", () => ({
  createSQLiteRepository: () => repository,
}));

import { POST } from "./route";

const body = {
  rankingRunId: "00000000-0000-4000-8000-000000000010",
  domainName: "finance",
  conversationUserId: "finance-user",
  decision: "accepted",
  interpretation: {
    id: "csv",
    title: "Export CSV",
    summary: "Send raw rows.",
    semanticTerms: ["csv", "raw rows"],
    features: ["format:csv"],
  },
};

function request(value: unknown = body, includeDevice = true): Request {
  return new Request("http://localhost/api/outcomes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(includeDevice ? { "x-device-id": "00000000-0000-4000-8000-000000000001" } : {}),
    },
    body: JSON.stringify(value),
  });
}

describe("POST /api/outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.rankingRunBelongsToUser.mockResolvedValue(true);
    repository.storeOutcome.mockResolvedValue(undefined);
    repository.resolveRankingReview.mockResolvedValue(true);
  });

  it("requires a browser device identifier", async () => {
    const response = await POST(request(body, false));

    expect(response.status).toBe(401);
    expect(repository.storeOutcome).not.toHaveBeenCalled();
  });

  it("does not allow feedback against another user's ranking run", async () => {
    repository.rankingRunBelongsToUser.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(repository.storeOutcome).not.toHaveBeenCalled();
  });

  it("embeds and stores an accepted interpretation with owner and conversation-user provenance", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(repository.storeOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "00000000-0000-4000-8000-000000000001",
        userId: "finance-user",
        domainName: "finance",
        sourceRankingRunId: body.rankingRunId,
        interpretationKey: "csv",
        decision: "accepted",
        accepted: true,
        embeddingModel: "resolve-local-feature-hash",
        embedding: expect.any(Array),
      }),
    );
    expect(repository.resolveRankingReview).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      body.rankingRunId,
    );
  });

  it("stores the selected candidate as rejected and the supplied correction as accepted", async () => {
    const response = await POST(
      request({
        ...body,
        decision: "corrected",
        correction: "Write a short apology email to the patient.",
      }),
    );

    expect(response.status).toBe(200);
    expect(repository.storeOutcome).toHaveBeenCalledTimes(2);
    expect(repository.storeOutcome).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        interpretationKey: "csv",
        decision: "corrected",
        accepted: false,
      }),
    );
    expect(repository.storeOutcome).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        interpretationKey: undefined,
        title: "Write a short apology email to the patient.",
        decision: "corrected",
        accepted: true,
      }),
    );
  });

  it("rejects corrected feedback without the intended replacement task", async () => {
    const response = await POST(request({ ...body, decision: "corrected" }));

    expect(response.status).toBe(400);
    expect(repository.storeOutcome).not.toHaveBeenCalled();
  });
});
