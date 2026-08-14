/** @file Regressions for deferred finance work and proposal follow-ups. */

import { describe, expect, it } from "vitest";

import { rankConversation } from "./engine";
import type { ConversationMessage, RankingInput } from "./types";

const messages: ConversationMessage[] = [
  { id: "M1", text: "We eventually need a finance monitoring dashboard.", timestamp: "2026-08-14T09:00:00Z" },
  { id: "M2", text: "First assess rate limiting for the ingestion service.", timestamp: "2026-08-14T09:01:00Z" },
  { id: "M3", text: "Write one concise implementation proposal for rate limiting.", timestamp: "2026-08-14T09:02:00Z" },
  { id: "M4", text: "No dashboard yet; defer that work until the proposal is approved.", timestamp: "2026-08-14T09:03:00Z" },
  { id: "M5", text: "Include rollout, retry budgets, and ownership in the proposal.", timestamp: "2026-08-14T09:04:00Z" },
  { id: "M6", text: "For the deferred dashboard, could MCP help later?", timestamp: "2026-08-14T09:05:00Z" },
  { id: "M7", text: "No MCP now, just get the proposal done.", timestamp: "2026-08-14T09:06:00Z" },
];

const input: RankingInput = {
  interpretations: [
    {
      id: "proposal-only",
      title: "Deliver one concise rate-limiting proposal",
      summary: "Write the implementation proposal now and keep dashboard and MCP work deferred.",
      semanticTerms: ["rate limiting", "implementation proposal", "rollout", "retry budgets"],
      features: ["deliverable:proposal", "dashboard:excluded", "mcp:excluded"],
    },
    {
      id: "dashboard-now",
      title: "Build the finance dashboard now",
      summary: "Implement the monitoring dashboard as the current deliverable.",
      semanticTerms: ["finance dashboard", "monitoring", "build dashboard"],
      features: ["deliverable:dashboard", "dashboard:required", "mcp:excluded"],
    },
    {
      id: "mcp-dashboard",
      title: "Research MCP and the dashboard now",
      summary: "Replace the proposal with MCP research and dashboard implementation.",
      semanticTerms: ["MCP", "dashboard", "research integration"],
      features: ["deliverable:mcp-research", "dashboard:required", "mcp:required"],
    },
  ],
  constraintRules: [
    { id: "proposal", phrases: ["implementation proposal", "get the proposal done"], dimension: "deliverable", value: "proposal", mode: "require", strength: 1, label: "Deliver the rate-limiting proposal" },
    { id: "dashboard-deferred", phrases: ["No dashboard yet"], dimension: "dashboard", value: "required", mode: "forbid", strength: 1, label: "No dashboard yet" },
    { id: "mcp-deferred", phrases: ["No MCP now"], dimension: "mcp", value: "required", mode: "forbid", strength: 1, label: "No MCP now" },
  ],
  history: [],
};

describe("finance follow-up ranking", () => {
  it("keeps the proposal active when message six only asks about deferred dashboard work", () => {
    const result = rankConversation(input, messages.slice(0, 6), {
      semantic: 1,
      constraints: 0,
      history: 0,
    });

    expect(result.ranking[0].id).toBe("proposal-only");
    expect(result.conversationTransitions.at(-1)).toMatchObject({
      messageId: "M6",
      kind: "question",
    });
    expect(result.latestReframe).toBeUndefined();
  });

  it("resumes the proposal at message seven and is decision-ready without MCP or dashboard", () => {
    const result = rankConversation(input, messages, {
      semantic: 0.4,
      constraints: 0.6,
      history: 0,
    });
    const proposal = result.ranking[0];

    expect(proposal.id).toBe("proposal-only");
    expect(proposal.features).toEqual(
      expect.arrayContaining(["dashboard:excluded", "mcp:excluded"]),
    );
    expect(result.conversationTransitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageId: "M4", kind: "deferral" }),
        expect.objectContaining({ messageId: "M6", kind: "question" }),
        expect.objectContaining({ messageId: "M7", kind: "resumption" }),
      ]),
    );
    expect(result.uncertain).toBe(false);
    expect(result.clarificationQuestion).toBeUndefined();
    expect(proposal.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Source: “No dashboard yet”", sentiment: "supports" }),
        expect.objectContaining({ text: "Source: “No MCP now”", sentiment: "supports" }),
      ]),
    );
    expect(
      result.ranking.find((candidate) => candidate.id === "mcp-dashboard")?.evidence,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Source: “No MCP now”", sentiment: "conflicts" }),
      ]),
    );
  });
});
