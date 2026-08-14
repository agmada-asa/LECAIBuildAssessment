/** @file Integration tests for the unified canonical-log ranking endpoint. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  analyseWithCodex,
  analyseWithOpenAICompatible,
  createSQLiteRepository,
  getProviderStatuses,
} = vi.hoisted(() => ({
  analyseWithCodex: vi.fn(),
  analyseWithOpenAICompatible: vi.fn(),
  createSQLiteRepository: vi.fn(),
  getProviderStatuses: vi.fn(),
}));

vi.mock("@/lib/providers/codex-exec", () => ({
  analyseWithCodex,
  getProviderStatuses,
}));

vi.mock("@/lib/providers/openai-compatible", () => ({
  analyseWithOpenAICompatible,
}));

vi.mock("@/lib/persistence/sqlite", () => ({
  createSQLiteRepository,
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
      text: "Book the dentist appointment for next Tuesday.",
      timestamp: "2026-08-14T08:00:30.000Z",
    },
    {
      id: "M3",
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
    analyseWithOpenAICompatible.mockReset();
    createSQLiteRepository.mockReset();
    createSQLiteRepository.mockReturnValue({});
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
    expect(body.result.ranking[0]).toHaveProperty("change.messageId", "M3");
    expect(
      new Set(body.result.constraints.map((item: { messageId: string }) => item.messageId)),
    ).toEqual(new Set(["M1", "M3"]));
    expect(body.result.activeConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "format", value: "csv", messageId: "M3" }),
      ]),
    );
    expect(body.result.rankingChange).toMatchObject({ messageId: "M3" });
    expect(body.result.mostInfluentialAxis).toMatchObject({ key: "constraints" });
    expect(body.result.processedMessageCount).toBe(3);
  });

  it("keeps ranking available when a request has no device identifier", async () => {
    const response = await POST(request({ provider: "demo", conversation }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.ranking).toHaveLength(3);
    expect(body.persistence).toMatchObject({
      enabled: true,
      identified: false,
    });
  });

  it("completes the queued revision with the direct analysis result", async () => {
    const ownerId = "00000000-0000-4000-8000-000000000001";
    const repository = {
      findSimilarOutcomes: vi.fn().mockResolvedValue([]),
      persistRankingRun: vi.fn().mockResolvedValue({
        id: "run-1",
        state: "decided",
        duplicate: false,
      }),
      completePendingRankingTask: vi.fn().mockResolvedValue(true),
    };
    createSQLiteRepository.mockReturnValue(repository);
    const response = await POST(new Request("http://localhost/api/rank", {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-id": ownerId },
      body: JSON.stringify({
        provider: "demo",
        conversation,
        queuedTask: { id: "task-1", revision: 3 },
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(repository.completePendingRankingTask).toHaveBeenCalledWith(
      ownerId,
      { id: "task-1", revision: 3 },
      expect.objectContaining({
        provider: expect.objectContaining({ id: "demo" }),
        result: body.result,
      }),
    );
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
          text: "Book the dentist appointment for next Tuesday.",
          timestamp: "2026-08-14T08:00:00.000Z",
        },
        {
          id: "M2",
          text: "No slides; send a dashboard link.",
          timestamp: "2026-08-14T08:00:30.000Z",
        },
        {
          id: "M3",
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

  it("returns a structured refusal when deterministic candidate generation is ungrounded", async () => {
    const sparseConversation = {
      ...conversation,
      messages: [conversation.messages[0]],
    };

    const response = await POST(
      request({ provider: "demo", conversation: sparseConversation }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("candidate_generation_unavailable");
    expect(body.error.message).toMatch(/three distinct tasks/i);
  });

  it("keeps the resumed rate-limiting proposal ahead of deferred dashboard and MCP work", async () => {
    const financeConversation = {
      ...conversation,
      conversationId: "finance-follow-up",
      messages: [
        "We eventually need a finance monitoring dashboard.",
        "First assess rate limiting for the ingestion service.",
        "Write one concise implementation proposal for rate limiting.",
        "No dashboard yet; defer that work until the proposal is approved.",
        "Include rollout, retry budgets, and ownership in the proposal.",
        "For the deferred dashboard, could MCP help later?",
        "No MCP now, just get the proposal done.",
      ].map((text, index) => ({
        id: `M${index + 1}`,
        text,
        timestamp: `2026-08-14T08:0${index}:00.000Z`,
      })),
    };

    const response = await POST(
      request({ provider: "demo", conversation: financeConversation }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.ranking[0].title).toMatch(/implementation proposal/i);
    expect(body.result.uncertain).toBe(false);
    expect(body.result.clarificationQuestion).toBeUndefined();
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

  it("preserves participant roles when sending a conversation to a live provider", async () => {
    getProviderStatuses.mockResolvedValue([
      { id: "codex", name: "Codex CLI", available: true },
    ]);
    analyseWithCodex.mockResolvedValue({
      interpretations: [
        {
          id: "incident-report",
          title: "Prepare the incident report",
          summary: "Document the production incident for the on-call handoff.",
          semanticTerms: ["incident report", "on-call", "handoff"],
          features: ["artifact:incident-report"],
        },
        {
          id: "hotfix-plan",
          title: "Plan the immediate hotfix",
          summary: "Describe the smallest safe repair for the production crash.",
          semanticTerms: ["immediate hotfix", "production crash", "repair"],
          features: ["artifact:hotfix-plan"],
        },
        {
          id: "redesign-plan",
          title: "Plan the session-state redesign",
          summary: "Describe the longer-term redesign and regression coverage.",
          semanticTerms: ["session state", "redesign", "regression tests"],
          features: ["artifact:redesign-plan"],
        },
      ],
      constraints: [],
      taskBoundaries: [],
      notes: "Only user-authored messages supplied task instructions.",
    });
    const authoredConversation = {
      ...conversation,
      conversationId: "authored-crash-report",
      messages: [
        {
          id: "CRASH-101",
          author: "user",
          text: "The iOS app started crashing after version 7.4 shipped.",
          timestamp: "2026-08-14T08:00:00.000Z",
        },
        {
          id: "CRASH-102",
          author: "assistant",
          text: "Do we have a symbolicated stack trace?",
          timestamp: "2026-08-14T08:01:00.000Z",
        },
        {
          id: "CRASH-103",
          author: "user",
          text: "Prepare an incident report and separate the hotfix from the redesign.",
          timestamp: "2026-08-14T08:02:00.000Z",
        },
      ],
    };

    const response = await POST(
      request({ provider: "codex", conversation: authoredConversation }),
    );

    expect(response.status).toBe(200);
    expect(analyseWithCodex).toHaveBeenCalledWith(
      expect.stringContaining(
        "[CRASH-101] (author=user; timestamp=2026-08-14T08:00:00.000Z):",
      ),
      undefined,
    );
    expect(analyseWithCodex.mock.calls[0][0]).toContain(
      "[CRASH-102] (author=assistant; timestamp=2026-08-14T08:01:00.000Z):",
    );
  });

  it("uses the configured OpenAI-compatible provider instead of the removed Ollama path", async () => {
    getProviderStatuses.mockResolvedValue([
      { id: "api", name: "OpenAI-compatible API", available: true },
    ]);
    analyseWithOpenAICompatible.mockResolvedValue({
      interpretations: [
        {
          id: "slides",
          title: "Prepare slides",
          summary: "Create a visual presentation.",
          semanticTerms: ["slides", "presentation", "visual"],
          features: ["format:slides"],
        },
        {
          id: "csv",
          title: "Export CSV",
          summary: "Send machine-readable rows.",
          semanticTerms: ["CSV", "raw rows", "export"],
          features: ["format:csv"],
        },
        {
          id: "dashboard",
          title: "Build a dashboard",
          summary: "Publish an interactive view.",
          semanticTerms: ["dashboard", "interactive", "view"],
          features: ["format:dashboard"],
        },
      ],
      constraints: [
        {
          id: "csv-required",
          phrases: ["CSV"],
          dimension: "format",
          value: "csv",
          mode: "require",
          strength: 1,
          label: "Send CSV",
        },
      ],
      taskBoundaries: [],
      notes: "API-generated alternatives.",
    });

    const response = await POST(request({ provider: "api", conversation }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.provider).toMatchObject({ id: "api", fallback: false });
    expect(analyseWithOpenAICompatible).toHaveBeenCalledTimes(1);
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

  it("returns a structured error when corrective normalization still fails", async () => {
    getProviderStatuses.mockResolvedValue([
      { id: "codex", name: "Codex CLI", available: true },
    ]);
    analyseWithCodex.mockResolvedValue({ interpretations: [], constraints: [] });

    const response = await POST(request({ provider: "codex", conversation }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("invalid_provider_output");
    expect(analyseWithCodex).toHaveBeenCalledTimes(2);
    expect(body.error.message).toMatch(/corrective retry/i);
  });

  it("corrects a schema-valid provider response rejected by normalization", async () => {
    getProviderStatuses.mockResolvedValue([
      { id: "codex", name: "Codex CLI", available: true },
    ]);
    const repeatedInterpretation = {
      id: "slides",
      title: "Prepare slides",
      summary: "Create a visual presentation.",
      semanticTerms: ["slides", "presentation", "visual"],
      features: ["format:slides"],
    };
    analyseWithCodex
      .mockResolvedValueOnce({
        interpretations: [
          repeatedInterpretation,
          { ...repeatedInterpretation, id: "slides-copy" },
          {
            id: "csv",
            title: "Export CSV",
            summary: "Send machine-readable rows.",
            semanticTerms: ["CSV", "raw rows", "export"],
            features: ["format:csv"],
          },
        ],
        constraints: [],
        taskBoundaries: [],
        notes: "The first attempt repeated one alternative.",
      })
      .mockResolvedValueOnce({
        interpretations: [
          repeatedInterpretation,
          {
            id: "csv",
            title: "Export CSV",
            summary: "Send machine-readable rows.",
            semanticTerms: ["CSV", "raw rows", "export"],
            features: ["format:csv"],
          },
          {
            id: "dashboard",
            title: "Build a dashboard",
            summary: "Publish an interactive view.",
            semanticTerms: ["dashboard", "interactive", "view"],
            features: ["format:dashboard"],
          },
        ],
        constraints: [],
        taskBoundaries: [],
        notes: "The corrected attempt contains three alternatives.",
      });

    const response = await POST(request({ provider: "codex", conversation }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.input.interpretations).toHaveLength(3);
    expect(analyseWithCodex).toHaveBeenCalledTimes(2);
    expect(analyseWithCodex.mock.calls[1][1]).toMatch(/previous response/i);
  });
});
