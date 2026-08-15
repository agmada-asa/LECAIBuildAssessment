/**
 * @file Browser-like interaction tests for the intent-ranking workbench.
 *
 * These tests exercise user-visible outcomes rather than component internals:
 * the initial winner, the rank shift after a contradictory message, and the
 * optional nature of local provider discovery.
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntentRanker } from "./intent-ranker";
import { EvidencePanel } from "./intent-ranker/evidence-panel";
import { ConversationPanel } from "./intent-ranker/conversation-panel";
import { RankingPanel } from "./intent-ranker/ranking-panel";
import { rankConversation } from "@/lib/ranking/engine";
import { DEFAULT_WEIGHTS } from "@/lib/ranking/policy";
import { getScenario } from "@/lib/ranking/test-scenarios";

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

  it("opens on arbitrary-log analysis without preloaded rankings or sample controls", () => {
    render(<IntentRanker />);

    expect(screen.getByRole("heading", { name: "Rank an ambiguous conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a conversation" })).toBeInTheDocument();
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
        canAcceptOutcome
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

  it("offers correction without accepting a non-task reading as task history", () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);
    render(
      <EvidencePanel
        result={result}
        selected={{ ...result.ranking[0], kind: "conversation" }}
        canSaveOutcome
        canAcceptOutcome={false}
        outcomeStatus=""
        onOutcome={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Accept interpretation" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Correct interpretation" })).toBeInTheDocument();
  });

  it("renders legacy results that do not include a conversation assessment", () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);
    const legacyResult = {
      ...result,
      conversationAssessment: undefined,
    } as unknown as typeof result;

    render(
      <EvidencePanel
        result={legacyResult}
        selected={legacyResult.ranking[0]}
        canSaveOutcome={false}
        canAcceptOutcome
        outcomeStatus=""
        onOutcome={vi.fn()}
      />,
    );

    expect(screen.getByText(result.explanation)).toBeInTheDocument();
    expect(screen.queryByText("Conversation assessment")).not.toBeInTheDocument();
  });

  it("shows a ranking-shift banner when the winner is newly introduced", () => {
    const scenario = getScenario("finance-reframe");
    const previousInput = {
      ...scenario,
      interpretations: scenario.interpretations.filter(
        (candidate) => candidate.id !== "csv-export",
      ),
    };
    const result = rankConversation(
      scenario,
      scenario.messages,
      DEFAULT_WEIGHTS,
      previousInput,
    );

    expect(result.ranking[0].id).toBe("csv-export");
    expect(result.ranking[0].previousRank).toBeUndefined();
    expect(result.rankingChange?.winnerChanged).toBe(true);
    render(
      <RankingPanel
        result={result}
        selectedId={result.ranking[0].id}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Ranking shifted");
    expect(screen.getByRole("status")).toHaveTextContent("newly introduced");
  });

  it("labels a generated TXT timestamp as unavailable", () => {
    render(
      <ConversationPanel
        messages={[{ id: "M1", text: "Imported TXT line", timestamp: "2000-01-01T00:00:00.000Z" }]}
        userName="imported-user"
        userRole="Domain not supplied"
        isProcessing={false}
        customMessage=""
        onCustomMessageChange={vi.fn()}
        onAddCustomMessage={vi.fn()}
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
        canAcceptOutcome
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

  it("visibly confirms an accepted interpretation and explains its effect", async () => {
    const scenario = getScenario("finance-reframe");
    const conversation = {
      conversationId: "acceptance-review",
      userId: "finance-user",
      domain: { name: "finance" },
      messages: scenario.messages,
      acceptedOutcomes: [],
    };
    const result = rankConversation(scenario, conversation.messages, DEFAULT_WEIGHTS);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/state") {
        return new Response(JSON.stringify({
          reference: { id: "run-1", state: "decided" },
          run: { provider: "codex", conversation, input: scenario, result },
        }));
      }
      if (String(input) === "/api/queue") {
        return new Response(JSON.stringify({ tasks: [] }));
      }
      if (String(input) === "/api/outcomes") {
        return new Response(JSON.stringify({ saved: true, decision: "accepted" }));
      }
      return new Response(JSON.stringify({ providers: operationalApiProviders }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    const acceptedTitle = result.ranking[0].title;
    expect(await screen.findByText(acceptedTitle)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept interpretation" }));

    expect(await screen.findByText("Interpretation accepted")).toBeInTheDocument();
    expect(screen.getByText(/saved as evidence for future similar conversations/i)).toBeInTheDocument();
    expect(
      within(screen.getByText(acceptedTitle).closest("button")!).getByText("Accepted"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Interpretation accepted" })).toBeDisabled();
    expect(screen.getByText("State: decided")).toBeInTheDocument();
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

  it("presents multiple conversational tasks in the collapsible sidebar", async () => {
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
                  state: "processing",
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

    await user.click(screen.getByRole("button", { name: "Expand task sidebar" }));

    expect(await screen.findByRole("complementary", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByText("finance-proposal")).toBeInTheDocument();
    expect(screen.getByText("apology-email")).toBeInTheDocument();
    expect(screen.getByText(/Write the rate-limiting proposal/)).toBeInTheDocument();
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    const taskRow = screen.getByText("finance-proposal").closest("article");
    expect(taskRow).not.toHaveClass("rounded-xl");
    expect(taskRow?.parentElement).toHaveClass("divide-y");

    await user.click(screen.getByRole("button", { name: "Collapse task sidebar" }));
    expect(screen.getByRole("button", { name: "Expand task sidebar" })).toBeInTheDocument();
    expect(screen.queryByText("finance-proposal")).not.toBeInTheDocument();
  });

  it("polls active queue tasks until their completed result is available", async () => {
    let queueReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/queue" && (!init?.method || init.method === "GET")) {
          queueReads += 1;
          const completed = queueReads > 1;
          return new Response(JSON.stringify({
            tasks: [{
              id: "task-processing",
              externalConversationId: "async-analysis",
              revision: 1,
              state: completed ? "decided" : "processing",
              attempts: 1,
              request: { conversation: { messages: [{}] } },
              result: completed ? {
                result: {
                  ranking: [{ title: "Prepare the completed analysis", confidence: 0.8 }],
                },
              } : undefined,
              createdAt: "2026-08-14T09:00:00.000Z",
              updatedAt: completed
                ? "2026-08-14T09:00:03.000Z"
                : "2026-08-14T09:00:00.000Z",
            }],
          }));
        }
        if (String(input) === "/api/state") return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ providers: operationalApiProviders }));
      }),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Expand task sidebar" }));
    expect(await screen.findByText("Analyzing")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(await screen.findByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("Prepare the completed analysis")).toBeInTheDocument();
    expect(queueReads).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(queueReads).toBe(2);
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
      "User: Send the raw rows.\nAssistant: Understood.\nUser: Make it CSV.",
    );
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));

    expect(screen.getByRole("heading", { name: "Message preview" })).toBeInTheDocument();
    expect(screen.getAllByText("M1").length).toBeGreaterThan(0);
    expect(screen.getByText("Assistant: Understood.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Analyze 3 messages" }));

    const rankCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/rank");
    const queueCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/queue");
    expect(rankCall).toBeTruthy();
    expect(queueCall).toBeTruthy();
    const body = JSON.parse((rankCall?.[1] as RequestInit).body as string);
    expect(body.conversation.messages.map((message: { id: string }) => message.id)).toEqual([
      "M1",
      "M2",
      "M3",
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

  it("continues the generated ID sequence when adding a follow-up", async () => {
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
      "M2",
      "M3",
    ]);
    expect(requestBody).not.toHaveProperty("previousInput");
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

  it("displays an error alert when analysis fails on initial import", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/providers") {
        return new Response(JSON.stringify({ providers: operationalApiProviders }));
      }
      if (String(input) === "/api/queue") {
        return new Response(JSON.stringify({ ok: true }));
      }
      if (String(input) === "/api/rank") {
        return new Response(JSON.stringify({ error: "Provider returned 401 Unauthorized" }), {
          status: 401,
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    await user.type(
      screen.getByRole("textbox", { name: "Paste conversation log" }),
      "test message for failure",
    );
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));
    await user.click(screen.getByRole("button", { name: "Analyze 1 messages" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Provider returned 401 Unauthorized/)).toBeInTheDocument();
  });

  it("removes the previous ranking when a replacement import fails", async () => {
    const scenario = getScenario("finance-reframe");
    const previousConversation = {
      conversationId: "previous-success",
      userId: "reviewer",
      messages: scenario.messages,
      acceptedOutcomes: [],
    };
    const previousResult = rankConversation(
      scenario,
      previousConversation.messages,
      DEFAULT_WEIGHTS,
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/providers") {
        return new Response(JSON.stringify({ providers: operationalApiProviders }));
      }
      if (String(input) === "/api/state") {
        return new Response(JSON.stringify({
          reference: { id: "run-previous", state: "decided" },
          run: {
            provider: "api",
            conversation: previousConversation,
            input: scenario,
            result: previousResult,
          },
        }));
      }
      if (String(input) === "/api/queue") {
        return new Response(JSON.stringify({ tasks: [] }));
      }
      if (String(input) === "/api/rank") {
        return new Response(JSON.stringify({ error: "Malformed provider output" }), {
          status: 502,
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    expect(await screen.findByText(previousResult.ranking[0].title)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    await user.type(
      screen.getByRole("textbox", { name: "Paste conversation log" }),
      "A replacement conversation that fails analysis.",
    );
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));
    await user.clear(screen.getByRole("textbox", { name: "Conversation name" }));
    await user.type(
      screen.getByRole("textbox", { name: "Conversation name" }),
      "failed-replacement",
    );
    await user.click(screen.getByRole("button", { name: "Analyze 1 messages" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No ranking is shown for failed-replacement",
    );
    expect(screen.queryByText(previousResult.ranking[0].title)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Plausible readings" })).not.toBeInTheDocument();
  });

  it("allows analyzing a second conversation without the button being frozen", async () => {
    const scenario = getScenario("finance-reframe");
    const firstResult = rankConversation(scenario, scenario.messages.slice(0, 1), DEFAULT_WEIGHTS);
    const secondResult = rankConversation(scenario, scenario.messages.slice(0, 2), DEFAULT_WEIGHTS);
    let callCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/providers") {
        return new Response(JSON.stringify({ providers: operationalApiProviders }));
      }
      if (String(input) === "/api/queue") {
        return new Response(JSON.stringify({ ok: true }));
      }
      if (String(input) === "/api/rank") {
        callCount++;
        return new Response(
          JSON.stringify({
            provider: { id: "demo", name: "Deterministic fallback", fallback: true, notes: "ok" },
            input: scenario,
            result: callCount === 1 ? firstResult : secondResult,
          }),
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    // First analysis
    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    await user.type(
      screen.getByRole("textbox", { name: "Paste conversation log" }),
      "first conversation line",
    );
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));
    await user.click(screen.getByRole("button", { name: "Analyze 1 messages" }));

    expect(await screen.findByText("Analyzed by Deterministic fallback")).toBeInTheDocument();

    // Second analysis
    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    const pasteInput = screen.getByRole("textbox", { name: "Paste conversation log" });
    await user.type(pasteInput, "second conversation line");
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));

    const analyzeBtn = screen.getByRole("button", { name: "Analyze 1 messages" });
    expect(analyzeBtn).not.toBeDisabled();
    await user.click(analyzeBtn);

    expect(callCount).toBe(2);
  });

  it("renders the file picker with hidden raw file input and multiline placeholder", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Analyze a log" }));

    const fileInput = document.querySelector("#conversation-file");
    expect(fileInput).toHaveClass("sr-only");

    const textarea = screen.getByRole("textbox", { name: "Paste conversation log" });
    expect(textarea).toHaveAttribute(
      "placeholder",
      "Prepare the June report.\nSend the raw rows.",
    );
  });

  it("allows renaming a conversation in the import dialog before analysis", async () => {
    const scenario = getScenario("finance-reframe");
    const fetchMock = vi.fn(
      async (...args: [input: RequestInfo | URL, init?: RequestInit]) => {
        const [input] = args;
        if (String(input) === "/api/providers") {
          return new Response(JSON.stringify({ providers: operationalApiProviders }));
        }
        if (String(input) === "/api/queue") {
          return new Response(JSON.stringify({ ok: true }));
        }
        if (String(input) === "/api/rank") {
          return new Response(
            JSON.stringify({
              provider: { id: "demo", name: "Deterministic fallback", fallback: true, notes: "ok" },
              input: scenario,
              result: rankConversation(scenario, scenario.messages.slice(0, 1), DEFAULT_WEIGHTS),
            }),
          );
        }
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Analyze a log" }));
    await user.type(
      screen.getByRole("textbox", { name: "Paste conversation log" }),
      "test line to rename",
    );
    await user.click(screen.getByRole("button", { name: "Preview conversation" }));

    const nameInput = screen.getByRole("textbox", { name: "Conversation name" });
    await user.clear(nameInput);
    await user.type(nameInput, "custom-renamed-conversation");

    await user.click(screen.getByRole("button", { name: "Analyze 1 messages" }));

    const rankCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/rank");
    expect(rankCall).toBeTruthy();
    const body = JSON.parse((rankCall?.[1] as RequestInit).body as string);
    expect(body.conversation.conversationId).toBe("custom-renamed-conversation");
  });

  it("allows renaming an active conversation on the workbench", async () => {
    const scenario = getScenario("finance-reframe");
    const conversation = {
      conversationId: "import-original-name",
      userId: "finance-user",
      domain: { name: "finance" },
      messages: scenario.messages.slice(0, 2),
      acceptedOutcomes: [],
    };
    const result = rankConversation(scenario, conversation.messages, DEFAULT_WEIGHTS);
    let resolveRename: ((response: Response) => void) | undefined;
    const renameResponse = new Promise<Response>((resolve) => {
      resolveRename = resolve;
    });
    const fetchMock = vi.fn(
      async (...args: [input: RequestInfo | URL, init?: RequestInit]) => {
        const [input, init] = args;
        if (String(input) === "/api/state") {
          return new Response(
            JSON.stringify({
              reference: { id: "run-1", state: "decided" },
              run: {
                provider: "codex",
                conversation,
                input: scenario,
                result,
              },
            }),
          );
        }
        if (String(input) === "/api/queue" && init?.method === "PATCH") {
          return renameResponse;
        }
        if (String(input) === "/api/queue") {
          return new Response(JSON.stringify({
            tasks: [{
              id: "task-1",
              externalConversationId: conversation.conversationId,
              revision: 1,
              state: "decided",
              attempts: 1,
              request: { ownerId: "owner-1", provider: "codex", conversation, weights: DEFAULT_WEIGHTS },
              result: {
                provider: { id: "codex", name: "Codex CLI", fallback: false, notes: "Stored." },
                input: scenario,
                result,
                persistence: { enabled: true, identified: true, state: "decided", rankingRunId: "run-1" },
              },
              createdAt: "2026-08-14T09:00:00.000Z",
              updatedAt: "2026-08-14T09:01:00.000Z",
            }],
          }));
        }
        return new Response(JSON.stringify({ providers: operationalApiProviders }));
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    expect(await screen.findByRole("heading", { name: "import-original-name" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand task sidebar" }));
    const taskSidebar = screen.getByRole("complementary", { name: "Tasks" });
    expect(within(taskSidebar).getByText("import-original-name")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename conversation" }));
    const renameInput = screen.getByRole("textbox", { name: "Edit conversation name" });
    await user.clear(renameInput);
    await user.type(renameInput, "my-renamed-task");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(screen.getByRole("heading", { name: "my-renamed-task" })).toBeInTheDocument();
    expect(within(taskSidebar).getByText("my-renamed-task")).toBeInTheDocument();
    expect(within(taskSidebar).queryByText("import-original-name")).not.toBeInTheDocument();
    const renameCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === "/api/queue" && init?.method === "PATCH",
    );
    expect(JSON.parse(renameCall?.[1]?.body as string)).toEqual({
      currentConversationId: "import-original-name",
      nextConversationId: "my-renamed-task",
    });
    resolveRename?.(new Response(JSON.stringify({ renamed: true })));
  });

  it("expands a candidate card into a modal displaying untruncated text via Show more", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);
    const candidate = result.ranking[0];

    render(
      <RankingPanel
        result={result}
        selectedId={candidate.id}
        onSelect={vi.fn()}
      />,
    );

    // Initial card view has line-clamp on summary
    const card = screen.getByRole("button", { name: new RegExp(candidate.title, "i") });
    expect(card).toBeInTheDocument();

    // Click the Show more button on the card
    const showMoreButton = screen.getByRole("button", {
      name: `Show more for #${candidate.rank}`,
    });
    expect(showMoreButton).toHaveTextContent("Show more");
    await user.click(showMoreButton);

    // Modal dialog is open
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // Untruncated summary and explanation are present in the dialog
    expect(within(dialog).getByText(candidate.summary)).toBeInTheDocument();
    expect(within(dialog).getByText(candidate.explanation)).toBeInTheDocument();
    expect(within(dialog).getByText(candidate.title)).toBeInTheDocument();

    // All evidence items are rendered without truncation
    for (const evidence of candidate.evidence) {
      expect(within(dialog).getByText(evidence.text)).toBeInTheDocument();
    }

    // Close the dialog
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("selects a candidate without opening the modal when clicking the card", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);
    const candidate = result.ranking[0];
    const onSelect = vi.fn();

    render(
      <RankingPanel
        result={result}
        selectedId={candidate.id}
        onSelect={onSelect}
      />,
    );

    // Clicking the card directly calls onSelect and does not open modal
    const card = screen.getByRole("button", { name: new RegExp(candidate.title, "i") });
    await user.click(card);

    expect(onSelect).toHaveBeenCalledWith(candidate.id);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("allows navigating between candidates inside the detail modal", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);
    expect(result.ranking.length).toBeGreaterThan(1);
    const firstCandidate = result.ranking[0];
    const secondCandidate = result.ranking[1];

    render(
      <RankingPanel
        result={result}
        selectedId={firstCandidate.id}
        onSelect={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: `Show more for #${firstCandidate.rank}`,
      }),
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(firstCandidate.title)).toBeInTheDocument();

    // Click Next candidate button inside dialog
    const nextButton = within(dialog).getByRole("button", { name: /next candidate/i });
    await user.click(nextButton);

    expect(within(dialog).getByText(secondCandidate.title)).toBeInTheDocument();
    expect(within(dialog).getByText(secondCandidate.summary)).toBeInTheDocument();
  });

  it("starts a new conversation from direct user input and submits it to /api/rank", async () => {
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
              id: "api",
              name: "OpenAI-compatible API",
              fallback: false,
              notes: "Live provider analysis",
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

    await user.click(screen.getByRole("button", { name: "Start a conversation" }));
    await user.type(
      screen.getByRole("textbox", { name: "Initial message" }),
      "Please prepare the quarterly earnings summary in CSV format.",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Conversation name (optional)" }),
      "Earnings Summary",
    );
    await user.type(
      screen.getByRole("textbox", { name: "User name (optional)" }),
      "Finance Lead",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Domain (optional)" }),
      "Finance",
    );

    await user.click(screen.getByRole("button", { name: "Start conversation" }));

    const rankCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/rank");
    const queueCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/queue");
    expect(rankCall).toBeTruthy();
    expect(queueCall).toBeTruthy();
    const body = JSON.parse((rankCall?.[1] as RequestInit).body as string);
    expect(body.conversation.conversationId).toBe("Earnings Summary");
    expect(body.conversation.userId).toBe("Finance Lead");
    expect(body.conversation.domain).toEqual({ name: "Finance" });
    expect(body.conversation.messages).toHaveLength(1);
    expect(body.conversation.messages[0].text).toBe(
      "Please prepare the quarterly earnings summary in CSV format.",
    );
    expect(
      screen.getByRole("heading", { name: "Earnings Summary" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Finance Lead")).toBeInTheDocument();
  });
});
