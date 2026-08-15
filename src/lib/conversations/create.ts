/**
 * @file Factory for constructing canonical conversation logs from direct user input.
 *
 * Creates validated ConversationLog structures for newly initiated conversations,
 * assigning standard initial message identifiers and timestamps.
 */

import { conversationLogSchema, type ConversationLog } from "./schema";

/** Options supplied when creating a new conversation log interactively. */
export type CreateConversationOptions = {
  /** The first message entered by the user. */
  initialMessage: string;
  /** Optional custom identifier or title for the conversation. */
  conversationId?: string;
  /** Optional user identifier associated with the request. */
  userId?: string;
  /** Optional display author name for the initial message. */
  author?: string;
  /** Optional domain category name. */
  domain?: string;
};

/** Generates a deterministic short identifier for a new conversation. */
function generateConversationId(): string {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.floor(Math.random() * 1679616).toString(36);
  return `conversation-${timestamp}${randomSuffix}`;
}

/**
 * Creates a canonical, schema-validated ConversationLog from an initial user message.
 *
 * @param options - Configuration options including the initial message and optional metadata.
 * @returns A validated ConversationLog containing the single initial message.
 * @throws Error if the initial message is empty after trimming or schema validation fails.
 */
export function createConversationLog(
  options: CreateConversationOptions,
): ConversationLog {
  const text = options.initialMessage.trim();
  if (!text) {
    throw new Error("Message text cannot be empty.");
  }

  const userId = options.userId?.trim() || "user";
  const author = options.author?.trim() || userId;
  const conversationId =
    options.conversationId?.trim() || generateConversationId();
  const domainName = options.domain?.trim();

  const rawLog = {
    conversationId,
    userId,
    ...(domainName ? { domain: { name: domainName } } : {}),
    messages: [
      {
        id: "M1",
        author,
        text,
        timestamp: new Date().toISOString(),
      },
    ],
    acceptedOutcomes: [],
  };

  return conversationLogSchema.parse(rawLog);
}
