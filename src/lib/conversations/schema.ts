/**
 * @file Canonical, Zod-validated contract for every imported conversation.
 *
 * The array order is authoritative. Source IDs are retained verbatim so every
 * constraint and evidence item can point back to the supplied log.
 */

import { z } from "zod";

const nonEmptyId = z.string().trim().min(1).max(200);
const metadataValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/** One message exactly as it enters the analysis pipeline. */
export const conversationMessageSchema = z.object({
  id: nonEmptyId,
  author: z.string().trim().min(1).max(100).optional(),
  text: z.string().trim().min(1, "Message text cannot be empty.").max(20_000),
  timestamp: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Use an ISO-8601 timestamp."),
});

/** A previously accepted task outcome available to the history scorer. */
export const acceptedOutcomeSchema = z.object({
  id: nonEmptyId,
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2_000),
  interpretationId: nonEmptyId.optional(),
  semanticTerms: z.array(z.string().trim().min(1)).max(20).optional(),
  features: z.array(z.string().trim().min(1)).max(20).optional(),
  acceptedAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Use an ISO-8601 timestamp.")
    .optional(),
});

/** The single format accepted by the unified ranking API. */
export const conversationLogSchema = z
  .object({
    conversationId: nonEmptyId,
    userId: nonEmptyId,
    domain: z
      .object({
        name: z.string().trim().min(1).max(100),
        metadata: z.record(z.string(), metadataValueSchema).optional(),
      })
      .optional(),
    messages: z.array(conversationMessageSchema).min(1, "Add at least one message."),
    acceptedOutcomes: z.array(acceptedOutcomeSchema).max(100).default([]),
  })
  .superRefine((log, context) => {
    const seenIds = new Set<string>();
    log.messages.forEach((message, index) => {
      if (seenIds.has(message.id)) {
        context.addIssue({
          code: "custom",
          path: ["messages", index, "id"],
          message: `Message ID “${message.id}” is duplicated.`,
        });
      }
      seenIds.add(message.id);
    });
  });

export type ConversationLog = z.infer<typeof conversationLogSchema>;
export type AcceptedOutcome = z.infer<typeof acceptedOutcomeSchema>;
