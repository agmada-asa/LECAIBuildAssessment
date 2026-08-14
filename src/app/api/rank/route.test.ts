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
    expect(
      body.result.constraints.every((item: { messageId: string }) => item.messageId === "M2"),
    ).toBe(true);
    expect(body.result.processedMessageCount).toBe(2);
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
