/**
 * @file Browser-like interaction tests for the intent-ranking workbench.
 *
 * These tests exercise user-visible outcomes rather than component internals:
 * the initial winner, the rank shift after a contradictory message, and the
 * optional nature of local provider discovery.
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntentRanker } from "./intent-ranker";
import { EvidencePanel } from "./intent-ranker/evidence-panel";
import { ConversationPanel } from "./intent-ranker/conversation-panel";
import { rankConversation } from "@/lib/ranking/engine";
import {
  DEFAULT_WEIGHTS,
  getScenario,
} from "@/lib/ranking/scenarios";

const operationalApiProviders = [{
  id: "api",
  name: "OpenAI-compatible API",
  available: true,
  configured: true,
  operational: true,
  localInference: false,
  detail: "Configured and ready",
}];

describe("IntentRanker", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Provider discovery is unavailable.")),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("opens on arbitrary-log analysis without fixture rankings or scenario controls", () => {
    render(<IntentRanker />);

    expect(screen.getByRole("heading", { name: "Rank an ambiguous conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze a log" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Demo scenario" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Plausible readings" })).not.toBeInTheDocument();
    expect(screen.queryByText(/resolve-local-feature-hash/)).not.toBeInTheDocument();
  });

  it("stacks decision actions so their labels fit the narrow evidence panel", () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);
    render(
      <EvidencePanel
        result={result}
        selected={result.ranking[0]}
        canSaveOutcome
        outcomeStatus=""
        onOutcome={vi.fn()}
      />,
    );

    const acceptButton = screen.getByRole("button", { name: "Accept interpretation" });
    const correctButton = screen.getByRole("button", { name: "Correct interpretation" });
    const actionGroup = acceptButton.parentElement;

    expect(actionGroup).toBe(correctButton.parentElement);
    expect(actionGroup).toHaveClass("grid-cols-1");
    expect(acceptButton).toHaveClass("w-full");
    expect(correctButton).toHaveClass("w-full");
  });

  it("labels a generated TXT timestamp as unavailable", () => {
    render(
      <ConversationPanel
        messages={[{ id: "M1", text: "Imported TXT line", timestamp: "2000-01-01T00:00:00.000Z" }]}
        totalFixtureMessages={1}
        userName="imported-user"
        userRole="Domain not supplied"
        isProcessing={false}
        customMessage=""
        onCustomMessageChange={vi.fn()}
        onAddCustomMessage={vi.fn()}
        onProcessNext={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByText("Message 1 · time unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/2000-01-01/)).not.toBeInTheDocument();
  });

  it("requires the actual intended task before saving a correction", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);
    const onOutcome = vi.fn();
    render(
      <EvidencePanel
        result={result}
        selected={result.ranking[0]}
        canSaveOutcome
        outcomeStatus=""
        onOutcome={onOutcome}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Correct interpretation" }));

    const intendedTask = screen.getByRole("textbox", { name: "Actual intended task" });
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
    await user.type(intendedTask, "Write a short apology email to the patient.");
    await user.click(screen.getByRole("button", { name: "Save correction" }));

    expect(onOutcome).toHaveBeenCalledWith(
      "corrected",
      "Write a short apology email to the patient.",
    );
  });

  it("restores the recorded provider and imported identity from durable state", async () => {
    const scenario = getScenario("finance-reframe");
    const conversation = {
      conversationId: "restored-log",
      userId: "imported-finance-user",
      domain: { name: "finance" },
      messages: scenario.messages.map((message, index) => ({
        ...message,
        timestamp: `2026-08-14T08:0${index}:00.000Z`,
      })),
      acceptedOutcomes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/state") {
          return new Response(
            JSON.stringify({
              reference: { id: "run-1", state: "decided" },
              run: {
                provider: "codex",
                conversation,
                input: scenario,
                result: rankConversation(scenario, conversation.messages, DEFAULT_WEIGHTS),
              },
            }),
          );
        }
        return new Response(JSON.stringify({ providers: operationalApiProviders }));
      }),
    );

    render(<IntentRanker />);

    expect(await screen.findByText("Analyzed by Codex CLI")).toBeInTheDocument();
    expect(screen.getByText("3 messages supplied for imported-finance-user.")).toBeInTheDocument();
  });

  it("opens an inspectable queue view for multiple conversational tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/queue" && (!init?.method || init.method === "GET")) {
          return new Response(
            JSON.stringify({
              tasks: [
                {
                  id: "task-1",
                  externalConversationId: "finance-proposal",
                  revision: 2,
                  state: "human_review",
                  attempts: 1,
                  request: { conversation: { messages: [{}, {}, {}] } },
                  result: {
                    result: {
                      ranking: [{ title: "Write the rate-limiting proposal", confidence: 0.64 }],
                    },
                  },
                  createdAt: "2026-08-14T09:00:00.000Z",
                  updatedAt: "2026-08-14T09:01:00.000Z",
                },
                {
                  id: "task-2",
                  externalConversationId: "apology-email",
                  revision: 1,
                  state: "pending",
                  attempts: 0,
                  request: { conversation: { messages: [{}] } },
                  createdAt: "2026-08-14T09:02:00.000Z",
                  updatedAt: "2026-08-14T09:02:00.000Z",
                },
              ],
            }),
          );
        }
        if (String(input) === "/api/state") return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ providers: operationalApiProviders }));
      }),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Task queue" }));

    expect(await screen.findByRole("heading", { name: "Task queue" })).toBeInTheDocument();
    expect(screen.getByText("finance-proposal")).toBeInTheDocument();
    expect(screen.getByText("apology-email")).toBeInTheDocument();
    expect(screen.getByText(/Write the rate-limiting proposal/)).toBeInTheDocument();
    expect(screen.getByText("human review")).toBeInTheDocument();
  });

  it("labels the weight preset control with a human-readable policy name", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Weights" }));

    expect(screen.getByRole("combobox", { name: "Weight preset" })).toHaveTextContent(
      "Explicit instructions first",
    );
  });

  it("previews a pasted log and sends its complete canonical form to /api/rank", async () => {
    const scenario = getScenario("finance-reframe");
    const apiResult = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);
    const fetchMock = vi.fn(
      async (...args: [input: RequestInfo | URL, init?: RequestInit]) => {
        const [input] = args;
        if (String(input) === "/api/providers") {
          return new Response(
            JSON.stringify({
              providers: operationalApiProviders,
            }),
          );
        }
        return new Response(
          JSON.stringify({
            provider: {
              id: "demo",
              name: "Deterministic fallback",
              fallback: true,
              notes: "Fallback analysis",
            },
            input: scenario,
            result: apiResult,
          }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    await user.type(
      screen.getByRole("textbox", { name: "Paste conversation log" }),
      "request-17: Send the raw rows.\nacknowledgement: Understood.\nreframe: Make it CSV.",
    );
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));

    expect(screen.getByRole("heading", { name: "Message preview" })).toBeInTheDocument();
    expect(screen.getAllByText("request-17").length).toBeGreaterThan(0);
    expect(screen.getByText("acknowledgement")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Analyze 3 messages" }));

    const rankCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/rank");
    const queueCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/queue");
    expect(rankCall).toBeTruthy();
    expect(queueCall).toBeTruthy();
    const body = JSON.parse((rankCall?.[1] as RequestInit).body as string);
    expect(body.conversation.messages.map((message: { id: string }) => message.id)).toEqual([
      "request-17",
      "acknowledgement",
      "reframe",
    ]);
    expect(screen.getByText("Analyzed by Deterministic fallback")).toBeInTheDocument();
  });

  it("previews an unlabelled TXT message without requiring a dialogue role", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    await user.type(
      screen.getByRole("textbox", { name: "Paste conversation log" }),
      "This is an arbitrary task-queue message",
    );
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));

    expect(screen.getAllByText("M1").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes the import dialog and shows the workbench as pending during analysis", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input) === "/api/rank") return new Promise<Response>(() => undefined);
        if (String(input) === "/api/providers") {
          return Promise.resolve(new Response(JSON.stringify({ providers: operationalApiProviders })));
        }
        return Promise.reject(new Error("Provider discovery is unavailable."));
      }),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    await user.type(
      screen.getByRole("textbox", { name: "Paste conversation log" }),
      "Prepare the quarterly review.",
    );
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));
    await user.click(screen.getByRole("button", { name: "Analyze 1 messages" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Analysis in progress" })).toHaveTextContent(
      "Analyzing conversation…",
    );
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("heading", { name: "Plausible readings" })).not.toBeInTheDocument();
  });

  it("generates a follow-up ID that cannot collide with imported source IDs", async () => {
    const scenario = getScenario("finance-reframe");
    const log = {
      conversationId: "source-log",
      userId: "reviewer",
      messages: [
        {
          id: "M1",
          text: "Prepare a concise review.",
          timestamp: "2026-08-14T08:00:00.000Z",
        },
        {
          id: "M3",
          text: "Send raw rows instead.",
          timestamp: "2026-08-14T08:01:00.000Z",
        },
      ],
      acceptedOutcomes: [],
    };
    const fetchMock = vi.fn(
      async (...args: [input: RequestInfo | URL, init?: RequestInit]) => {
        const [input] = args;
        if (String(input) === "/api/providers") {
          return new Response(JSON.stringify({ providers: operationalApiProviders }));
        }
        return new Response(
          JSON.stringify({
            provider: {
              id: "demo",
              name: "Deterministic fallback",
              fallback: true,
              notes: "Fallback analysis",
            },
            input: scenario,
            result: rankConversation(scenario, log.messages, DEFAULT_WEIGHTS),
          }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Paste conversation log" }), {
      target: { value: JSON.stringify(log) },
    });
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));
    await user.click(screen.getByRole("button", { name: "Analyze 2 messages" }));
    await user.type(
      screen.getByRole("textbox", { name: "Add a follow-up message" }),
      "Include a machine-readable export.",
    );
    await user.click(screen.getByRole("button", { name: "Add follow-up message" }));

    const rankCalls = fetchMock.mock.calls.filter(([url]) => String(url) === "/api/rank");
    const requestBody = JSON.parse((rankCalls.at(-1)?.[1] as RequestInit).body as string);
    expect(requestBody.conversation.messages.map((message: { id: string }) => message.id)).toEqual([
      "M1",
      "M3",
      "M4",
    ]);
    expect(requestBody.previousInput.interpretations).toEqual(scenario.interpretations);
  });

  it("recalculates an imported ranking immediately when weights change", async () => {
    const scenario = getScenario("finance-reframe");
    const log = {
      conversationId: "weighted-log",
      userId: "reviewer",
      messages: scenario.messages.map((message, index) => ({
        ...message,
        timestamp: `2026-08-14T08:0${index}:00.000Z`,
      })),
      acceptedOutcomes: [],
    };
    const initialResult = rankConversation(scenario, log.messages, DEFAULT_WEIGHTS);
    const adjustedWeights = { ...DEFAULT_WEIGHTS, constraints: 55 };
    const adjustedResult = rankConversation(scenario, log.messages, adjustedWeights);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/providers") {
        return new Response(JSON.stringify({ providers: operationalApiProviders }));
      }
      return new Response(
        JSON.stringify({
          provider: {
            id: "demo",
            name: "Deterministic fallback",
            fallback: true,
            notes: "Fallback analysis",
          },
          input: scenario,
          result: initialResult,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Paste conversation log" }), {
      target: { value: JSON.stringify(log) },
    });
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));
    await user.click(screen.getByRole("button", { name: "Analyze 3 messages" }));

    const candidateTitle = "Export finance-ready CSV data";
    const initialCandidate = initialResult.ranking.find((item) => item.title === candidateTitle)!;
    const adjustedCandidate = adjustedResult.ranking.find((item) => item.title === candidateTitle)!;
    expect(initialCandidate.total).not.toBe(adjustedCandidate.total);
    expect(within(screen.getByText(candidateTitle).closest("button")!).getByText(
      `weighted score ${initialCandidate.total.toFixed(3)}`,
    )).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Weights" }));
    const constraintSlider = screen.getByRole("group", {
      name: "Constraint consistency weight",
    });
    const range = constraintSlider.querySelector<HTMLInputElement>("input[type='range']")!;
    range.focus();
    fireEvent.keyDown(range, { key: "ArrowRight" });

    expect(within(screen.getByText(candidateTitle).closest("button")!).getByText(
      `weighted score ${adjustedCandidate.total.toFixed(3)}`,
    )).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/rank")).toHaveLength(1);
  });
});
