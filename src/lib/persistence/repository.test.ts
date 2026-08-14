/** @file Repository contract tests for idempotency, ordering, and tenant isolation. */

import { describe, expect, it } from "vitest";

import { InMemoryRankingRepository } from "./repository";
import type { PersistedRankingRun, StoredTaskOutcome } from "./types";
import { historicalScore } from "@/lib/ranking/scoring";

const run: PersistedRankingRun = {
  ownerId: "owner-a",
  idempotencyKey: "same-request",
  provider: "demo",
  weights: { semantic: 0.3, constraints: 0.5, history: 0.2 },
  conversation: {
    conversationId: "conversation-1",
    userId: "user-a",
    domain: { name: "finance" },
    messages: [
      { id: "M2", text: "Second", timestamp: "2026-08-14T09:01:00.000Z" },
      { id: "M1", text: "First", timestamp: "2026-08-14T09:00:00.000Z" },
    ],
    acceptedOutcomes: [],
  },
  input: { interpretations: [], constraintRules: [], history: [] },
  result: {} as PersistedRankingRun["result"],
};

function outcome(overrides: Partial<StoredTaskOutcome> = {}): StoredTaskOutcome {
  return {
    id: "outcome-a",
    ownerId: "owner-a",
    userId: "user-a",
    domainName: "finance",
    interpretationKey: "csv",
    title: "Export CSV",
    summary: "Send machine-readable finance rows",
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

describe("InMemoryRankingRepository", () => {
  it("persists message array order and makes repeated runs idempotent", async () => {
    const repository = new InMemoryRankingRepository();

    const first = await repository.persistRankingRun(run);
    const retry = await repository.persistRankingRun(run);

    expect(retry.id).toBe(first.id);
    expect(repository.inspectConversation(first.conversationId)?.messages).toEqual([
      expect.objectContaining({ sourceId: "M2", position: 0 }),
      expect.objectContaining({ sourceId: "M1", position: 1 }),
    ]);
    expect(repository.inspectRuns()).toHaveLength(1);
    expect(await repository.rankingRunBelongsToUser(first.id, "owner-a")).toBe(true);
    expect(await repository.rankingRunBelongsToUser(first.id, "owner-b")).toBe(false);
    expect(await repository.latestRankingState("owner-a")).toMatchObject({
      reference: { id: first.id },
      run: { conversation: { conversationId: "conversation-1" } },
    });
  });

  it("retrieves similar outcomes only for the same user and domain", async () => {
    const repository = new InMemoryRankingRepository();
    await repository.storeOutcome(outcome());
    await repository.storeOutcome(
      outcome({ id: "other-user", userId: "user-b", embedding: [1, 0, 0] }),
    );
    await repository.storeOutcome(
      outcome({ id: "other-domain", domainName: "legal", embedding: [1, 0, 0] }),
    );
    await repository.storeOutcome(
      outcome({ id: "less-similar", embedding: [0, 1, 0] }),
    );

    const matches = await repository.findSimilarOutcomes({
      ownerId: "owner-a",
      userId: "user-a",
      domainName: "finance",
      embedding: [1, 0, 0],
      embeddingModel: "test",
      embeddingVersion: "1",
      limit: 5,
    });

    expect(matches.map((match) => match.id)).toEqual(["outcome-a", "less-similar"]);
    expect(matches[0].similarity).toBe(1);
  });

  it("does not contaminate a domain-less apology task with structured-data history", async () => {
    const repository = new InMemoryRankingRepository();
    await repository.storeOutcome(outcome({
      userId: "finance-user",
      domainName: "finance",
      embedding: [1, 0, 0],
    }));
    await repository.storeOutcome(outcome({
      id: "rejected-csv",
      userId: "apology-user",
      domainName: undefined,
      accepted: false,
      decision: "corrected",
      embedding: [1, 0, 0],
    }));

    const matches = await repository.findSimilarOutcomes({
      ownerId: "owner-a",
      userId: "apology-user",
      domainName: undefined,
      embedding: [1, 0, 0],
      embeddingModel: "test",
      embeddingVersion: "1",
      limit: 5,
    });
    const score = historicalScore(
      {
        id: "apology-email",
        title: "Write an apology email",
        summary: "Apologise to the patient for the delay.",
        semanticTerms: ["apology", "email", "patient"],
        features: ["format:email"],
      },
      [{ id: "M1", text: "Write the apology email.", timestamp: "2026-08-14T09:00:00Z" }],
      matches.map((match) => ({
        id: match.id,
        interpretationId: match.interpretationKey,
        summary: match.summary,
        terms: match.semanticTerms,
        accepted: match.accepted,
      })),
    );

    expect(matches).toEqual([]);
    expect(score.score).toBeLessThan(0.86);
  });
});
