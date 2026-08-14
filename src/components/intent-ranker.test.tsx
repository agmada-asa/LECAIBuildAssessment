/**
 * @file Browser-like interaction tests for the intent-ranking workbench.
 *
 * These tests exercise user-visible outcomes rather than component internals:
 * the initial winner, the rank shift after a contradictory message, and the
 * optional nature of local provider discovery.
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntentRanker } from "./intent-ranker";

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

  it("shows three competing interpretations with the review deck ranked first", () => {
    render(<IntentRanker />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "The client review that became a data handoff",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Three plausible readings" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Live conversation analysis")).not.toBeInTheDocument();
    expect(screen.queryByText("Interpretation ranking")).not.toBeInTheDocument();
    expect(screen.queryByText("Decision brief")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Demo scenario" })).toHaveTextContent(
      "Finance reframe",
    );
    expect(screen.getByText("Create a client review deck")).toBeInTheDocument();
    expect(screen.getByText("Export finance-ready CSV data")).toBeInTheDocument();
    expect(screen.getByText("Publish a performance dashboard")).toBeInTheDocument();

    const reviewDeckCard = screen
      .getByText("Create a client review deck")
      .closest("button");
    expect(reviewDeckCard).toHaveTextContent("1");
    expect(reviewDeckCard).toHaveAttribute("aria-pressed", "true");
  });

  it("moves the CSV interpretation to rank one after processing the reframe", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Process next message" }));
    await act(async () => {
      vi.advanceTimersByTime(650);
    });

    expect(screen.getByText(/Ranking shifted\./)).toBeInTheDocument();
    expect(screen.getByText("Reframe detected")).toBeInTheDocument();

    const csvCard = screen
      .getByText("Export finance-ready CSV data")
      .closest("button");
    expect(csvCard).toHaveTextContent("1");
  });

  it("labels the weight preset control with a human-readable policy name", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<IntentRanker />);

    await user.click(screen.getByRole("button", { name: "Weights" }));

    expect(screen.getByRole("combobox", { name: "Weight preset" })).toHaveTextContent(
      "Explicit instructions first",
    );
  });
});
