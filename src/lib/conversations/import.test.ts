/** @file Parser tests for JSON, CSV, TXT, and malformed conversation imports. */

import { describe, expect, it } from "vitest";

import { ConversationImportError, parseConversationInput } from "./import";

describe("parseConversationInput", () => {
  it("normalises a JSON message array and preserves source order and IDs", () => {
    const result = parseConversationInput(
      JSON.stringify([
        { id: "source-2", content: "Do you need slides?" },
        { id: "source-1", content: "No, send CSV." },
      ]),
      { format: "json" },
    );

    expect(result.messages.map((message) => message.id)).toEqual([
      "source-2",
      "source-1",
    ]);
    expect(result.messages.map((message) => message.text)).toEqual([
      "Do you need slides?",
      "No, send CSV.",
    ]);
  });

  it("parses quoted CSV text without requiring author roles", () => {
    const result = parseConversationInput(
      'id,text,timestamp\nM1,"Send rows, not slides",2026-08-14T08:00:00Z\nM2,Understood,2026-08-14T08:01:00Z',
      { format: "csv" },
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].text).toBe("Send rows, not slides");
  });

  it("parses arbitrary TXT message IDs without requiring dialogue roles", () => {
    const result = parseConversationInput(
      "task-17: Prepare the report\nfinance-question: Which format?\nNo slides",
      { format: "txt" },
    );

    expect(result.messages.map((message) => message.id)).toEqual([
      "task-17",
      "finance-question",
      "M3",
    ]);
    expect(result.messages.map((message) => message.text)).toEqual([
      "Prepare the report",
      "Which format?",
      "No slides",
    ]);
  });

  it("returns actionable errors for incomplete and malformed imports", () => {
    expect(() =>
      parseConversationInput("id,text\nM1,", { format: "csv" }),
    ).toThrowError(ConversationImportError);
    expect(() => parseConversationInput("{broken", { format: "json" })).toThrow(
      /valid JSON/,
    );
  });
});
