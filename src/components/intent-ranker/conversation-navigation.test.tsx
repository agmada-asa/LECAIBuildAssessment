/**
 * @file Regression coverage for reopening analysed conversations from the task queue.
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntentRanker } from "@/components/intent-ranker";
import { rankConversation } from "@/lib/ranking/engine";
import { DEFAULT_WEIGHTS, getScenario } from "@/lib/ranking/scenarios";

describe("conversation navigation", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("opens a completed queue conversation in the workbench", async () => {
    const scenario = getScenario("finance-reframe");
    const conversation = {
      conversationId: "reopen-finance-review",
      userId: "finance-owner",
      domain: { name: "finance" },
      messages: scenario.messages,
      acceptedOutcomes: [],
    };
    const result = rankConversation(scenario, conversation.messages, DEFAULT_WEIGHTS);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/state") return new Response(null, { status: 204 });
      if (String(input) === "/api/providers") return new Response(JSON.stringify({ providers: [] }));
      if (String(input) === "/api/queue") {
        return new Response(JSON.stringify({
          tasks: [{
            id: "task-1",
            externalConversationId: conversation.conversationId,
            revision: 1,
            state: "decided",
            attempts: 1,
            request: { ownerId: "owner-1", provider: "api", conversation, weights: DEFAULT_WEIGHTS },
            result: {
              provider: { id: "api", name: "OpenAI-compatible API", fallback: false, notes: "Stored result." },
              input: scenario,
              result,
              persistence: { enabled: true, identified: true, state: "decided", rankingRunId: "run-1" },
            },
            createdAt: "2026-08-14T09:00:00.000Z",
            updatedAt: "2026-08-14T09:01:00.000Z",
          }],
        }));
      }
      return new Response(null, { status: 404 });
    }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Expand task sidebar" }));
    expect(await screen.findByRole("complementary", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open reopen-finance-review" }));

    expect(screen.getByRole("heading", { name: "reopen-finance-review" })).toBeInTheDocument();
    expect(screen.getByText("3 messages supplied for finance-owner.")).toBeInTheDocument();
    expect(screen.getByText("Analyzed by OpenAI-compatible API")).toBeInTheDocument();
    expect(screen.getByText("State: decided")).toBeInTheDocument();
  });

  it("sends the queued revision with direct analysis instead of starting a second provider call", async () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      const [input] = args;
      if (String(input) === "/api/state") return new Response(null, { status: 204 });
      if (String(input) === "/api/providers") {
        return new Response(JSON.stringify({ providers: [{
          id: "api",
          name: "OpenAI-compatible API",
          available: true,
          configured: true,
          operational: true,
          localInference: false,
          detail: "Configured and ready",
        }] }));
      }
      if (String(input) === "/api/queue" && args[1]?.method === "POST") {
        return new Response(JSON.stringify({ task: {
          id: "task-queued",
          revision: 4,
        } }), { status: 202 });
      }
      if (String(input) === "/api/queue") {
        return new Response(JSON.stringify({ tasks: [] }));
      }
      if (String(input) === "/api/rank") {
        return new Response(JSON.stringify({
          provider: { id: "api", name: "OpenAI-compatible API", fallback: false, notes: "Done." },
          input: scenario,
          result,
          persistence: { enabled: true, identified: true, state: "decided", rankingRunId: "run-1" },
        }));
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    await user.type(
      screen.getByRole("textbox", { name: "Paste conversation log" }),
      "Prepare the quarterly review.",
    );
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));
    await user.click(screen.getByRole("button", { name: "Analyze 1 messages" }));

    const rankCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/rank");
    const rankBody = JSON.parse(rankCall?.[1]?.body as string);
    expect(rankBody.queuedTask).toEqual({ id: "task-queued", revision: 4 });
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/queue/process")).toBe(false);
  });
});
