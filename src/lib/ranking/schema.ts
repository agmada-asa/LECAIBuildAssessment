/** @file Runtime validation for normalized ranking inputs returned to the browser. */

import { z } from "zod";

const interpretationSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(["task", "conversation", "insufficient-context"]).optional(),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  semanticTerms: z.array(z.string().trim().min(1)).min(1),
  features: z.array(z.string().trim().min(1)).min(1),
});

const constraintRuleSchema = z.object({
  id: z.string().trim().min(1),
  phrases: z.array(z.string().trim().min(1)).min(1),
  dimension: z.string().trim().min(1),
  value: z.string().trim().min(1),
  mode: z.enum(["require", "forbid"]),
  strength: z.number().min(0).max(1),
  label: z.string().trim().min(1),
});

const historicalTaskSchema = z.object({
  id: z.string().trim().min(1),
  interpretationId: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1),
  terms: z.array(z.string().trim().min(1)),
  accepted: z.boolean(),
});

/** Validates a prior server-produced input before it is reused for comparisons. */
export const rankingInputSchema = z.object({
  interpretations: z.array(interpretationSchema).min(1).max(5),
  constraintRules: z.array(constraintRuleSchema),
  history: z.array(historicalTaskSchema),
  taskBoundaries: z
    .array(
      z.object({
        messageId: z.string().trim().min(1),
        reason: z.string().trim().min(1),
      }),
    )
    .optional(),
  conversationAssessment: z.object({
    kind: z.enum([
      "actionable-task",
      "ordinary-conversation",
      "insufficient-context",
      "undetermined",
    ]),
    summary: z.string().trim().min(1),
    evidenceMessageIds: z.array(z.string().trim().min(1)),
    knownFacts: z.array(z.string().trim().min(1)),
    unknowns: z.array(z.string().trim().min(1)),
  }).optional(),
});
