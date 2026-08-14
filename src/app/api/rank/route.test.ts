/** @file Integration tests for the unified canonical-log ranking endpoint. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { analyseWithCodex, getProviderStatuses } = vi.hoisted(() => ({
  analyseWithCodex: vi.fn(),
  getProviderStatuses: vi.fn(),
}));

vi.mock("@/lib/providers/codex-exec", () => ({
  analyseWithCodex,
  getProviderStatuses,
}));

import { POST } from "./route";

const conversation = {
  conversationId: "conversation-1",
  userId: "user-1",
  messages: [
    {
      id: "M1",
      text: "I can make slides.",
      timestamp: "2026-08-14T08:00:00.000Z",
    },
    {
      id: "M2",
      text: "No slides. Send the raw rows as CSV.",
      timestamp: "2026-08-14T08:01:00.000Z",
    },
  ],
  acceptedOutcomes: [],
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/rank", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/rank", () => {
  beforeEach(() => {
    analyseWithCodex.mockReset();
    getProviderStatuses.mockReset();
  });

  it("runs an arbitrary canonical log through the complete deterministic pipeline", async () => {
    const response = await POST(request({ provider: "demo", conversation }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.provider).toMatchObject({ id: "demo", fallback: true });
    expect(body.input.interpretations).toHaveLength(3);
    expect(body.result.ranking).toHaveLength(3);
    expect(body.result.ranking[0]).toHaveProperty("signals.semantic");
    expect(body.result.ranking[0]).toHaveProperty("previous.signals.semantic");
    expect(body.result.ranking[0]).toHaveProperty("deltas.confidence");
    expect(body.result.ranking[0]).toHaveProperty("deltas.rank");
    expect(body.result.ranking[0]).toHaveProperty("change.messageId", "M2");
    expect(
      new Set(body.result.constraints.map((item: { messageId: string }) => item.messageId)),
    ).toEqual(new Set(["M1", "M2"]));
    expect(body.result.activeConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "format", value: "csv", messageId: "M2" }),
      ]),
    );
    expect(body.result.rankingChange).toMatchObject({ messageId: "M2" });
    expect(body.result.mostInfluentialAxis).toMatchObject({ key: "constraints" });
    expect(body.result.processedMessageCount).toBe(2);
  });

  it("uses the prior run's candidate catalogue for follow-up movement", async () => {
    const previousInput = {
      interpretations: [
        {
          id: "old-slides",
          title: "Prepare the original slides",
          summary: "Prepare the slide task shown before the follow-up.",
          semanticTerms: ["make slides", "slides", "presentation"],
          features: ["format:slides"],
        },
        {
          id: "old-memo",
          title: "Write the original memo",
          summary: "Write a memo instead of the requested slides.",
          semanticTerms: ["memo", "document", "written"],
          features: ["format:memo"],
        },
        {
          id: "old-dashboard",
          title: "Build the original dashboard",
          summary: "Build a dashboard instead of the requested slides.",
          semanticTerms: ["dashboard", "interactive", "monitor"],
          features: ["format:dashboard"],
        },
      ],
      constraintRules: [],
      history: [],
    };

    const response = await POST(
      request({
        provider: "demo",
        conversation,
        weights: { semantic: 100, constraints: 0, history: 0 },
        previousInput,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.rankingChange).toMatchObject({
      winnerChanged: true,
      previousWinner: { id: "old-slides" },
    });
    expect(body.result.rankingChange.previousWinnerExplanation).toContain(
      "no longer returned",
    );
  });

  it("handles no slides followed by PowerPoint after all through the demo provider", async () => {
    const reversal = {
      ...conversation,
      messages: [
        {
          id: "M1",
          text: "No slides; send a dashboard link.",
          timestamp: "2026-08-14T08:00:00.000Z",
        },
        {
          id: "M2",
          text: "Make it PowerPoint after all.",
          timestamp: "2026-08-14T08:01:00.000Z",
        },
      ],
    };

    const response = await POST(request({ provider: "demo", conversation: reversal }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.activeConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "format", value: "slides", mode: "require" }),
      ]),
    );
    expect(body.result.reframes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          previousConstraint: expect.objectContaining({ mode: "forbid", value: "slides" }),
          replacementConstraint: expect.objectContaining({ mode: "require", value: "slides" }),
        }),
      ]),
    );
  });

  it("returns structured, actionable validation errors", async () => {
    const response = await POST(
      request({ provider: "demo", conversation: { ...conversation, messages: [] } }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_conversation");
    expect(body.error.issues[0]).toHaveProperty("path");
  });

  it("reports an unavailable selected provider without silently falling back", async () => {
    getProviderStatuses.mockResolvedValue([
      { id: "codex", name: "Codex CLI", available: false },
    ]);

    const response = await POST(request({ provider: "codex", conversation }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("provider_unavailable");
    expect(analyseWithCodex).not.toHaveBeenCalled();
  });

  it("applies a provider-grounded boundary for an unseen unrelated topic change", async () => {
    getProviderStatuses.mockResolvedValue([
      { id: "codex", name: "Codex CLI", available: true },
    ]);
    analyseWithCodex.mockResolvedValue({
      interpretations: [
        {
          id: "email",
          title: "Write the onboarding email",
          summary: "Welcome new employees with a friendly email.",
          semanticTerms: ["welcome email", "new employees", "friendly"],
          features: ["topic:employee-onboarding", "format:email", "tone:friendly"],
        },
        {
          id: "checklist",
          title: "Create an onboarding checklist",
          summary: "Give new employees a practical onboarding checklist.",
          semanticTerms: ["new employees", "onboarding", "checklist"],
          features: ["topic:employee-onboarding", "format:checklist", "tone:direct"],
        },
        {
          id: "database",
          title: "Continue the database investigation",
          summary: "Diagnose replication lag and document it in a runbook.",
          semanticTerms: ["replication lag", "database", "diagnostic runbook"],
          features: ["topic:database-reliability", "format:runbook", "tone:technical"],
        },
      ],
      constraints: [
        {
          id: "database-topic",
          phrases: ["replication lag"],
          dimension: "topic",
          value: "database-reliability",
          mode: "require",
          strength: 1,
          label: "Investigate database reliability",
        },
        {
          id: "runbook-format",
          phrases: ["diagnostic runbook"],
          dimension: "format",
          value: "runbook",
          mode: "require",
          strength: 0.8,
          label: "Prepare a diagnostic runbook",
        },
        {
          id: "onboarding-topic",
          phrases: ["welcome email"],
          dimension: "topic",
          value: "employee-onboarding",
          mode: "require",
          strength: 1,
          label: "Welcome new employees",
        },
        {
          id: "friendly-tone",
          phrases: ["friendly"],
          dimension: "tone",
          value: "friendly",
          mode: "require",
          strength: 0.8,
          label: "Use a friendly tone",
        },
      ],
      taskBoundaries: [
        {
          messageId: "M2",
          reason: "The request changes from database reliability to employee onboarding.",
        },
      ],
      notes: "The final message replaces an unrelated earlier task.",
    });
    const topicConversation = {
      ...conversation,
      messages: [
        {
          id: "M1",
          text: "Investigate replication lag and prepare a diagnostic runbook.",
          timestamp: "2026-08-14T08:00:00.000Z",
        },
        {
          id: "M2",
          text: "Write a friendly welcome email for new employees.",
          timestamp: "2026-08-14T08:01:00.000Z",
        },
      ],
    };

    const response = await POST(request({ provider: "codex", conversation: topicConversation }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.activeConstraints).toHaveLength(2);
    expect(body.result.activeConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "employee-onboarding", messageId: "M2" }),
        expect.objectContaining({ value: "friendly", messageId: "M2" }),
      ]),
    );
    expect(body.result.constraints.filter((item: { messageId: string }) => item.messageId === "M1").every((item: { superseded: boolean }) => item.superseded)).toBe(true);
    expect(body.result.reframes.every((event: { kind: string }) => event.kind === "task-switch")).toBe(true);
  });

  it("retries one transient provider failure and redacts diagnostics", async () => {
    getProviderStatuses.mockResolvedValue([
      { id: "codex", name: "Codex CLI", available: true },
    ]);
    analyseWithCodex.mockRejectedValue(new Error("/private/path token=secret"));

    const response = await POST(request({ provider: "codex", conversation }));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(analyseWithCodex).toHaveBeenCalledTimes(2);
    expect(body).toContain("provider_failure");
    expect(body).not.toContain("private/path");
    expect(body).not.toContain("secret");
  });

  it("returns a structured error for malformed provider output", async () => {
    getProviderStatuses.mockResolvedValue([
      { id: "codex", name: "Codex CLI", available: true },
    ]);
    analyseWithCodex.mockResolvedValue({ interpretations: [], constraints: [] });

    const response = await POST(request({ provider: "codex", conversation }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("invalid_provider_output");
    expect(analyseWithCodex).toHaveBeenCalledTimes(1);
  });
});
