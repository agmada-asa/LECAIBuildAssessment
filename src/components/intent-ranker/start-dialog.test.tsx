/**
 * @file Unit and interaction tests for the StartConversationDialog component.
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StartConversationDialog } from "./start-dialog";
import type { ProviderStatus } from "@/lib/providers/types";

const mockProviders: ProviderStatus[] = [
  {
    id: "api",
    name: "OpenAI-compatible API",
    available: true,
    configured: true,
    operational: true,
    localInference: false,
    detail: "Configured and ready",
  },
  {
    id: "codex",
    name: "Codex CLI",
    available: false,
    configured: false,
    operational: false,
    localInference: true,
    detail: "CLI not found",
  },
];

describe("StartConversationDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the trigger button and opens dialog on click", async () => {
    const user = userEvent.setup();
    render(
      <StartConversationDialog
        providers={mockProviders}
        provider="api"
        onProviderChange={vi.fn()}
        onStart={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Start a conversation" });
    expect(trigger).toBeInTheDocument();

    await user.click(trigger);

    expect(screen.getByRole("heading", { name: "Start a conversation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Initial message")).toBeInTheDocument();
    expect(screen.getByLabelText("Conversation name (optional)")).toBeInTheDocument();
  });

  it("disables submit button when initial message is empty", async () => {
    const user = userEvent.setup();
    render(
      <StartConversationDialog
        providers={mockProviders}
        provider="api"
        onProviderChange={vi.fn()}
        onStart={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start a conversation" }));

    const submitButton = screen.getByRole("button", { name: "Start conversation" });
    expect(submitButton).toBeDisabled();
  });

  it("submits the conversation with valid message and metadata", async () => {
    const user = userEvent.setup();
    const handleStart = vi.fn().mockResolvedValue(undefined);

    render(
      <StartConversationDialog
        providers={mockProviders}
        provider="api"
        onProviderChange={vi.fn()}
        onStart={handleStart}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start a conversation" }));

    await user.type(
      screen.getByLabelText("Initial message"),
      "Please prepare the Q3 financial report.",
    );
    await user.type(
      screen.getByLabelText("Conversation name (optional)"),
      "Q3 Report",
    );
    await user.type(
      screen.getByLabelText("User name (optional)"),
      "Alice",
    );
    await user.type(
      screen.getByLabelText("Domain (optional)"),
      "Finance",
    );

    const submitButton = screen.getByRole("button", { name: "Start conversation" });
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);

    expect(
      screen.queryByRole("heading", { name: "Start a conversation" }),
    ).not.toBeInTheDocument();
    expect(handleStart).toHaveBeenCalledTimes(1);
    const [calledLog, calledProvider] = handleStart.mock.calls[0];
    expect(calledProvider).toBe("api");
    expect(calledLog.conversationId).toBe("Q3 Report");
    expect(calledLog.userId).toBe("Alice");
    expect(calledLog.domain).toEqual({ name: "Finance" });
    expect(calledLog.messages).toHaveLength(1);
    expect(calledLog.messages[0].text).toBe("Please prepare the Q3 financial report.");
  });

  it("closes the dialog immediately upon submission while analysis runs", async () => {
    const user = userEvent.setup();
    let resolveStart: () => void = () => {};
    const handleStart = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        }),
    );

    render(
      <StartConversationDialog
        providers={mockProviders}
        provider="api"
        onProviderChange={vi.fn()}
        onStart={handleStart}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start a conversation" }));
    await user.type(screen.getByLabelText("Initial message"), "Test message");
    await user.click(screen.getByRole("button", { name: "Start conversation" }));

    // Dialog closes immediately while handleStart is still pending
    expect(
      screen.queryByRole("heading", { name: "Start a conversation" }),
    ).not.toBeInTheDocument();
    expect(handleStart).toHaveBeenCalledTimes(1);

    resolveStart();
  });
});
