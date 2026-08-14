/** @file Public contract tests for canonical conversational logs. */

import { describe, expect, it } from "vitest";

import { conversationLogSchema } from "./schema";

const validLog = {
  conversationId: "conversation-1",
  userId: "user-1",
  domain: { name: "finance", metadata: { region: "UK" } },
  messages: [
    {
      id: "message-1",
      text: "Send the raw rows.",
      timestamp: "2026-08-14T08:00:00.000Z",
    },
  ],
  acceptedOutcomes: [
    {
      id: "outcome-1",
      title: "CSV export",
      summary: "Finance accepted a CSV export.",
    },
  ],
};

describe("conversationLogSchema", () => {
  it("accepts the canonical format and trims usable message text", () => {
    const result = conversationLogSchema.parse({
      ...validLog,
      messages: [{ ...validLog.messages[0], text: "  Send the raw rows.  " }],
    });

    expect(result.messages[0].text).toBe("Send the raw rows.");
    expect(result.messages[0].id).toBe("message-1");
  });

  it("rejects empty logs and whitespace-only messages", () => {
    expect(() =>
      conversationLogSchema.parse({ ...validLog, messages: [] }),
    ).toThrow();
    expect(() =>
      conversationLogSchema.parse({
        ...validLog,
        messages: [{ ...validLog.messages[0], text: "   " }],
      }),
    ).toThrow();
  });

  it("rejects duplicate source-message IDs without reordering messages", () => {
    const messages = [
      validLog.messages[0],
      { ...validLog.messages[0], text: "A later request." },
    ];
    const result = conversationLogSchema.safeParse({ ...validLog, messages });

    expect(result.success).toBe(false);
    expect(messages.map((message) => message.text)).toEqual([
      "Send the raw rows.",
      "A later request.",
    ]);
  });

  it("does not require a user or assistant author role", () => {
    const result = conversationLogSchema.parse({
      ...validLog,
      messages: [{ ...validLog.messages[0] }],
    });

    expect(result.messages[0]).not.toHaveProperty("author");
  });
});
