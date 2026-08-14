/**
 * @file HTTP contract tests for the optional live-analysis endpoint.
 *
 * The route accepts validated local requests while ensuring provider failures
 * cannot echo local paths, stderr, or credential material to the caller.
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { analyseWithCodex, analyseWithOpenAICompatible } = vi.hoisted(() => ({
  analyseWithCodex: vi.fn(),
  analyseWithOpenAICompatible: vi.fn(),
}));

vi.mock("@/lib/providers/codex-exec", () => ({ analyseWithCodex }));
vi.mock("@/lib/providers/openai-compatible", () => ({ analyseWithOpenAICompatible }));

import { POST } from "./route";

/** Builds a JSON request accepted by the route under test. */
function createRequest(body: unknown): Request {
  return new Request("http://localhost/api/analyse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/analyse", () => {
  beforeEach(() => {
    analyseWithCodex.mockReset();
    analyseWithOpenAICompatible.mockReset();
  });

  it("returns a concise validation error without echoing rejected input", async () => {
    const privateInput = "private";
    const response = await POST(
      createRequest({ provider: "codex", conversation: privateInput }),
    );
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(body)).toEqual({
      error: "Enter a conversation between 10 and 20,000 characters.",
    });
    expect(body).not.toContain(privateInput);
  });

  it("redacts provider diagnostics from the public error response", async () => {
    analyseWithCodex.mockRejectedValue(
      new Error("/Users/example/.codex/auth.json: token=private-value"),
    );

    const response = await POST(
      createRequest({
        provider: "codex",
        conversation: "Summarise this sufficiently long conversation.",
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain("The local provider could not complete the analysis.");
    expect(body).not.toContain("private-value");
    expect(body).not.toContain("auth.json");
  });
});
