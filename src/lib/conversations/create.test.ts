/** @file Unit tests for canonical conversation creation from user inputs. */

import { describe, expect, it } from "vitest";

import { createConversationLog } from "./create";

describe("createConversationLog", () => {
  it("creates a canonical conversation log with a single message and default metadata", () => {
    const log = createConversationLog({
      initialMessage: "Prepare the quarterly financial report.",
    });

    expect(log.conversationId).toMatch(/^conversation-[a-z0-9]+$/);
    expect(log.userId).toBe("user");
    expect(log.domain).toBeUndefined();
    expect(log.messages).toHaveLength(1);
    expect(log.messages[0].id).toBe("M1");
    expect(log.messages[0].text).toBe("Prepare the quarterly financial report.");
    expect(log.messages[0].author).toBe("user");
    expect(new Date(log.messages[0].timestamp).toISOString()).toBe(
      log.messages[0].timestamp,
    );
    expect(log.acceptedOutcomes).toEqual([]);
  });

  it("uses provided conversation name, user name, and domain metadata", () => {
    const log = createConversationLog({
      initialMessage: "Run the database migration script.",
      conversationId: "DB Migration Task",
      userId: "alex-dev",
      author: "Alex",
      domain: "Infrastructure",
    });

    expect(log.conversationId).toBe("DB Migration Task");
    expect(log.userId).toBe("alex-dev");
    expect(log.domain).toEqual({ name: "Infrastructure" });
    expect(log.messages).toHaveLength(1);
    expect(log.messages[0].id).toBe("M1");
    expect(log.messages[0].text).toBe("Run the database migration script.");
    expect(log.messages[0].author).toBe("Alex");
    expect(log.acceptedOutcomes).toEqual([]);
  });

  it("trims whitespace from text, IDs, and metadata", () => {
    const log = createConversationLog({
      initialMessage: "   Deploy version 2.0   ",
      conversationId: "  Release 2.0  ",
      userId: "  eng-lead  ",
      domain: "  DevOps  ",
    });

    expect(log.conversationId).toBe("Release 2.0");
    expect(log.userId).toBe("eng-lead");
    expect(log.domain).toEqual({ name: "DevOps" });
    expect(log.messages[0].text).toBe("Deploy version 2.0");
    expect(log.messages[0].author).toBe("eng-lead");
  });

  it("throws an error when the initial message is empty or only whitespace", () => {
    expect(() =>
      createConversationLog({
        initialMessage: "   ",
      }),
    ).toThrow(/Message text cannot be empty/);
  });
});
