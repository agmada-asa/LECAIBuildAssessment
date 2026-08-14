/**
 * @file Regression coverage for reopening analysed conversations from the task queue.
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
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

  it("displays a newly analysed log in the task sidebar immediately during and after analysis", async () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);
    let queueState: "empty" | "pending" | "completed" = "empty";

    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      const [input] = args;
      if (String(input) === "/api/state") return new Response(null, { status: 204 });
      if (String(input) === "/api/providers") {
        return new Response(JSON.stringify({
          providers: [{
            id: "api",
            name: "OpenAI-compatible API",
            available: true,
            configured: true,
            operational: true,
            localInference: false,
            detail: "Configured and ready",
          }],
        }));
      }
      if (String(input) === "/api/queue" && args[1]?.method === "POST") {
        queueState = "pending";
        return new Response(JSON.stringify({
          task: {
            id: "task-new",
            revision: 1,
          },
        }), { status: 202 });
      }
      if (String(input) === "/api/queue") {
        if (queueState === "empty") {
          return new Response(JSON.stringify({ tasks: [] }));
        }
        if (queueState === "pending") {
          return new Response(JSON.stringify({
            tasks: [{
              id: "task-new",
              externalConversationId: "new-quarterly-review",
              revision: 1,
              state: "pending",
              attempts: 0,
              request: {
                ownerId: "owner-1",
                provider: "api",
                conversation: {
                  conversationId: "new-quarterly-review",
                  userId: "imported-user",
                  messages: [{ id: "M1", text: "Prepare the quarterly review.", timestamp: "2026-08-14T09:00:00.000Z" }],
                  acceptedOutcomes: [],
                },
              },
              createdAt: "2026-08-14T09:00:00.000Z",
              updatedAt: "2026-08-14T09:00:00.000Z",
            }],
          }));
        }
        return new Response(JSON.stringify({
          tasks: [{
            id: "task-new",
            externalConversationId: "new-quarterly-review",
            revision: 1,
            state: "decided",
            attempts: 1,
            request: {
              ownerId: "owner-1",
              provider: "api",
              conversation: {
                conversationId: "new-quarterly-review",
                userId: "imported-user",
                messages: [{ id: "M1", text: "Prepare the quarterly review.", timestamp: "2026-08-14T09:00:00.000Z" }],
                acceptedOutcomes: [],
              },
            },
            result: {
              provider: { id: "api", name: "OpenAI-compatible API", fallback: false, notes: "Done." },
              input: scenario,
              result,
              persistence: { enabled: true, identified: true, state: "decided", rankingRunId: "run-new" },
            },
            createdAt: "2026-08-14T09:00:00.000Z",
            updatedAt: "2026-08-14T09:01:00.000Z",
          }],
        }));
      }
      if (String(input) === "/api/rank") {
        queueState = "completed";
        return new Response(JSON.stringify({
          provider: { id: "api", name: "OpenAI-compatible API", fallback: false, notes: "Done." },
          input: scenario,
          result,
          persistence: { enabled: true, identified: true, state: "decided", rankingRunId: "run-new" },
        }));
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Expand task sidebar" }));
    expect(screen.getByText("Imported conversations will appear here.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    await user.type(
      screen.getByRole("textbox", { name: "Paste conversation log" }),
      "Prepare the quarterly review.",
    );
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));
    const nameInput = screen.getByRole("textbox", { name: "Conversation name" });
    await user.clear(nameInput);
    await user.type(nameInput, "new-quarterly-review");
    await user.click(screen.getByRole("button", { name: "Analyze 1 messages" }));

    const taskSidebar = screen.getByRole("complementary", { name: "Tasks" });
    expect(await within(taskSidebar).findByText("new-quarterly-review")).toBeInTheDocument();
    expect(within(taskSidebar).getByText("Complete")).toBeInTheDocument();
  });

  it("shows the task in the sidebar while analysis is in progress", async () => {
    let queueState: "empty" | "pending" | "completed" = "empty";
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      const [input] = args;
      if (String(input) === "/api/state") return new Response(null, { status: 204 });
      if (String(input) === "/api/providers") {
        return new Response(JSON.stringify({
          providers: [{
            id: "api",
            name: "OpenAI-compatible API",
            available: true,
            configured: true,
            operational: true,
            localInference: false,
            detail: "Configured and ready",
          }],
        }));
      }
      if (String(input) === "/api/queue" && args[1]?.method === "POST") {
        queueState = "pending";
        return new Response(JSON.stringify({
          task: { id: "task-inflight", revision: 1 },
        }), { status: 202 });
      }
      if (String(input) === "/api/queue") {
        if (queueState === "empty") return new Response(JSON.stringify({ tasks: [] }));
        return new Response(JSON.stringify({
          tasks: [{
            id: "task-inflight",
            externalConversationId: "inflight-task",
            revision: 1,
            state: "pending",
            attempts: 0,
            request: {
              ownerId: "owner-1",
              provider: "api",
              conversation: {
                conversationId: "inflight-task",
                userId: "imported-user",
                messages: [{ id: "M1", text: "In flight log", timestamp: "2026-08-14T09:00:00.000Z" }],
                acceptedOutcomes: [],
              },
            },
            createdAt: "2026-08-14T09:00:00.000Z",
            updatedAt: "2026-08-14T09:00:00.000Z",
          }],
        }));
      }
      if (String(input) === "/api/rank") {
        // Keeps the analysis in-flight
        return new Promise<Response>(() => undefined);
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Expand task sidebar" }));
    expect(screen.getByText("Imported conversations will appear here.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    await user.type(
      screen.getByRole("textbox", { name: "Paste conversation log" }),
      "In flight log",
    );
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));
    const nameInput = screen.getByRole("textbox", { name: "Conversation name" });
    await user.clear(nameInput);
    await user.type(nameInput, "inflight-task");
    await user.click(screen.getByRole("button", { name: "Analyze 1 messages" }));

    const taskSidebar = screen.getByRole("complementary", { name: "Tasks" });
    expect(await within(taskSidebar).findByText("inflight-task")).toBeInTheDocument();
    expect(within(taskSidebar).getByText("Analyzing")).toBeInTheDocument();
    expect(
      within(taskSidebar).queryByRole("button", { name: /Resume .* waiting task/ }),
    ).not.toBeInTheDocument();
  });

  it("updates the sidebar when re-analysing a conversation with the same conversation ID", async () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);
    let queueState: "initial" | "reanalysed" = "initial";

    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      const [input] = args;
      if (String(input) === "/api/state") return new Response(null, { status: 204 });
      if (String(input) === "/api/providers") {
        return new Response(JSON.stringify({
          providers: [{
            id: "api",
            name: "OpenAI-compatible API",
            available: true,
            configured: true,
            operational: true,
            localInference: false,
            detail: "Configured and ready",
          }],
        }));
      }
      if (String(input) === "/api/queue" && args[1]?.method === "POST") {
        queueState = "reanalysed";
        return new Response(JSON.stringify({
          task: { id: "task-same-id", revision: 2 },
        }), { status: 202 });
      }
      if (String(input) === "/api/queue") {
        const title = queueState === "initial"
          ? "Initial interpretation title"
          : "Updated interpretation title";
        return new Response(JSON.stringify({
          tasks: [{
            id: "task-same-id",
            externalConversationId: "repeat-log",
            revision: queueState === "initial" ? 1 : 2,
            state: "decided",
            attempts: 1,
            request: {
              ownerId: "owner-1",
              provider: "api",
              conversation: {
                conversationId: "repeat-log",
                userId: "imported-user",
                messages: [{ id: "M1", text: "Initial message", timestamp: "2026-08-14T09:00:00.000Z" }],
                acceptedOutcomes: [],
              },
            },
            result: {
              provider: { id: "api", name: "OpenAI-compatible API", fallback: false, notes: "Done." },
              input: scenario,
              result: {
                ...result,
                ranking: [{ ...result.ranking[0], title }],
              },
              persistence: { enabled: true, identified: true, state: "decided", rankingRunId: "run-same" },
            },
            createdAt: "2026-08-14T09:00:00.000Z",
            updatedAt: "2026-08-14T09:01:00.000Z",
          }],
        }));
      }
      if (String(input) === "/api/rank") {
        return new Response(JSON.stringify({
          provider: { id: "api", name: "OpenAI-compatible API", fallback: false, notes: "Done." },
          input: scenario,
          result: {
            ...result,
            ranking: [{ ...result.ranking[0], title: "Updated interpretation title" }],
          },
          persistence: { enabled: true, identified: true, state: "decided", rankingRunId: "run-same" },
        }));
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Expand task sidebar" }));
    const taskSidebar = screen.getByRole("complementary", { name: "Tasks" });
    expect(await within(taskSidebar).findByText("repeat-log")).toBeInTheDocument();
    expect(within(taskSidebar).getByText("Initial interpretation title")).toBeInTheDocument();

    // Re-analyse with the same conversation ID
    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    await user.type(
      screen.getByRole("textbox", { name: "Paste conversation log" }),
      "Updated message",
    );
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));
    const nameInput = screen.getByRole("textbox", { name: "Conversation name" });
    await user.clear(nameInput);
    await user.type(nameInput, "repeat-log");
    await user.click(screen.getByRole("button", { name: "Analyze 1 messages" }));

    expect(await within(taskSidebar).findByText("Updated interpretation title")).toBeInTheDocument();
  });
});
