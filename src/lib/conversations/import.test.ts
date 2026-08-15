/** @file Parser tests for JSON, CSV, TXT, and malformed conversation imports. */

import { describe, expect, it } from "vitest";

import { ConversationImportError, parseConversationInput } from "./import";

describe("parseConversationInput", () => {
  it("normalises a JSON message array into ordered generated IDs", () => {
    const result = parseConversationInput(
      JSON.stringify([
        { id: "duplicate", author: "person-a", content: "Do you need slides?" },
        { id: "duplicate", author: "person-b", content: "No, send CSV." },
      ]),
      { format: "json" },
    );

    expect(result.messages.map((message) => message.id)).toEqual(["M1", "M2"]);
    expect(result.messages.map((message) => message.author)).toEqual([
      "person-a",
      "person-b",
    ]);
    expect(result.messages.map((message) => message.text)).toEqual([
      "Do you need slides?",
      "No, send CSV.",
    ]);
  });

  it("parses each CSV row and replaces duplicate source IDs", () => {
    const result = parseConversationInput(
      'id,text,timestamp\nduplicate,"Send rows, not slides",2026-08-14T08:00:00Z\nduplicate,Understood,2026-08-14T08:01:00Z',
      { format: "csv" },
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((message) => message.id)).toEqual(["M1", "M2"]);
    expect(result.messages[0].text).toBe("Send rows, not slides");
  });

  it("parses every non-empty TXT line without interpreting colon prefixes", () => {
    const result = parseConversationInput(
      "User: Prepare the report\nAssistant: Which format?\nUser: No slides",
      { format: "txt" },
    );

    expect(result.messages.map((message) => message.id)).toEqual(["M1", "M2", "M3"]);
    expect(result.messages.map((message) => message.text)).toEqual([
      "User: Prepare the report",
      "Assistant: Which format?",
      "User: No slides",
    ]);
  });

  it("normalises message IDs inside a canonical JSON conversation", () => {
    const result = parseConversationInput(
      JSON.stringify({
        conversationId: "canonical-log",
        userId: "imported-user",
        messages: [
          { id: "User", text: "First request" },
          { id: "User", text: "Second request" },
        ],
        acceptedOutcomes: [],
      }),
      { format: "json" },
    );

    expect(result.messages.map((message) => message.id)).toEqual(["M1", "M2"]);
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
