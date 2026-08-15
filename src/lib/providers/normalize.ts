/**
 * @file Validates and converts provider proposals into canonical ranker input.
 *
 * This boundary owns stable candidate keys, feature syntax, duplicate removal,
 * and user-message grounding. Provider prose never enters scoring unchecked.
 */

import { z } from "zod";

import type { ConversationLog } from "@/lib/conversations/schema";
import { selectUserInstructionMessages } from "@/lib/ranking/constraints";
import type { RankingInput } from "@/lib/ranking/types";
import type { ProviderAnalysis } from "./types";

const featureSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*$/i,
    "Feature tags must use dimension:value syntax.",
  );

/** Runtime schema shared by every provider before ranking. */
export const providerAnalysisSchema = z.object({
  conversationAssessment: z.object({
    kind: z.enum([
      "actionable-task",
      "ordinary-conversation",
      "insufficient-context",
    ]),
    summary: z.string().trim().min(1).max(2_000),
    evidenceMessageIds: z.array(z.string().trim().min(1).max(200)).max(100),
    knownFacts: z.array(z.string().trim().min(1).max(1_000)).max(20),
    unknowns: z.array(z.string().trim().min(1).max(1_000)).max(20),
  }).optional(),
  interpretations: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        kind: z.enum(["task", "conversation", "insufficient-context"]).default("task"),
        title: z.string().trim().min(1).max(200),
        summary: z.string().trim().min(1).max(2_000),
        semanticTerms: z.array(z.string().trim().min(1)).min(3).max(10),
        features: z.array(featureSchema).min(1).max(20),
      }),
    )
    .min(1)
    .max(5),
  constraints: z.array(
    z.object({
      id: z.string().trim().min(1),
      phrases: z.array(z.string().trim().min(1)).min(1),
      dimension: z.string().trim().regex(/^[a-z][a-z0-9-]*$/i),
      value: z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/i),
      mode: z.enum(["require", "forbid"]),
      strength: z.number().min(0).max(1),
      label: z.string().trim().min(1),
    }),
  ),
  taskBoundaries: z
    .array(
      z.object({
        messageId: z.string().trim().min(1).max(200),
        reason: z.string().trim().min(1).max(1_000),
      }),
    )
    .default([]),
  notes: z.string().trim(),
});

/** Makes a stable, readable candidate key from its title. */
function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "interpretation"
  );
}

/** Canonicalises text for grounding and duplicate comparisons. */
function normaliseText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const groundingStopWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "create",
  "deliver",
  "do",
  "for",
  "from",
  "in",
  "into",
  "later",
  "make",
  "must",
  "no",
  "not",
  "of",
  "on",
  "or",
  "prepare",
  "produce",
  "replacement",
  "require",
  "required",
  "task",
  "the",
  "this",
  "to",
  "use",
  "with",
  "without",
]);

/** Returns source-bearing words used to keep displayed evidence faithful. */
function groundingTerms(value: string): Set<string> {
  return new Set(
    normaliseText(value)
      .split(" ")
      .filter((token) => token.length > 2 && !groundingStopWords.has(token)),
  );
}

/**
 * Prevents a provider from presenting an inference from omitted information as
 * if it were an explicit source-grounded constraint.
 */
function hasGroundedLabel(label: string, phrase: string): boolean {
  const labelTerms = groundingTerms(label);
  const phraseTerms = groundingTerms(phrase);
  return [...labelTerms].some((term) => phraseTerms.has(term));
}

/** Checks whether the source phrase names the canonical constraint itself. */
function hasGroundedConstraintIdentity(
  dimension: string,
  value: string,
  phrase: string,
): boolean {
  const identityTerms = groundingTerms(`${dimension} ${value.replace(/-/g, " ")}`);
  const phraseTerms = groundingTerms(phrase);
  return [...identityTerms].some((term) => phraseTerms.has(term));
}

/** A pure acknowledgement cannot support a new constraint or task boundary. */
function isConversationalAcknowledgement(value: string): boolean {
  const text = normaliseText(value);
  return /^(?:(?:great|perfect|okay|ok|cool|sure|thanks|thank you|got it|sounds good)(?: see you (?:there|then))?|see you (?:there|then))$/.test(
    text,
  );
}

/** Requires a self-contained request cue before accepting a whole-task switch. */
function containsTaskRequest(value: string): boolean {
  const text = normaliseText(value);
  return (
    /\b(?:can|could|would|will) you\b/.test(text) ||
    /\b(?:please|must|need to|have to|make sure)\b/.test(text) ||
    /\b(?:i|we) (?:need|want|require)\b/.test(text) ||
    /\b(?:task|request|brief|deliverable|goal|priority|work) (?:is|becomes|should be|has changed to)\b/.test(
      text,
    ) ||
    /^(?:add|book|build|call|check|compare|create|draft|export|find|fix|get|investigate|make|prepare|publish|record|remove|review|schedule|send|set|show|summari[sz]e|tell|test|update|write)\b/.test(
      text,
    )
  );
}

/** Returns token overlap against the smaller candidate description. */
function overlap(left: string, right: string): number {
  const leftTokens = new Set(normaliseText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normaliseText(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let matches = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) matches += 1;
  });
  return matches / Math.min(leftTokens.size, rightTokens.size);
}

/** Returns true when candidates explicitly choose different values for one dimension. */
function haveConflictingFeatures(left: string[], right: string[]): boolean {
  const leftByDimension = new Map(
    left.map((feature) => feature.toLowerCase().split(":", 2) as [string, string]),
  );
  return right.some((feature) => {
    const [dimension, value] = feature.toLowerCase().split(":", 2);
    const leftValue = leftByDimension.get(dimension);
    return leftValue !== undefined && leftValue !== value;
  });
}

/** Measures agreement between explicit canonical feature selections. */
function sharedFeatureRatio(left: string[], right: string[]): number {
  const leftSet = new Set(left.map((feature) => feature.toLowerCase()));
  const rightSet = new Set(right.map((feature) => feature.toLowerCase()));
  const shared = [...leftSet].filter((feature) => rightSet.has(feature)).length;
  return shared / Math.max(1, Math.min(leftSet.size, rightSet.size));
}

/** Drops presentation modifiers that commonly pad one decision into paraphrases. */
function decisionText(value: string): string {
  return normaliseText(value)
    .split(" ")
    .filter(
      (token) =>
        !["combined", "concise", "implementation", "only", "one", "single"].includes(token),
    )
    .join(" ");
}

/** Provider-neutral semantic duplicate check, guarded by feature conflicts. */
function areEquivalentCandidates(
  left: RankingInput["interpretations"][number],
  right: ProviderAnalysis["interpretations"][number],
): boolean {
  if (haveConflictingFeatures(left.features, right.features)) return false;
  const proseOverlap = overlap(
    `${left.title} ${left.summary}`,
    `${right.title} ${right.summary}`,
  );
  const decisionOverlap = overlap(decisionText(left.title), decisionText(right.title));
  return (
    proseOverlap >= 0.82 ||
    decisionOverlap >= 0.8 ||
    (sharedFeatureRatio(left.features, right.features) >= 0.5 && proseOverlap >= 0.35)
  );
}

/** Maps accepted outcomes to the closest current candidate for history scoring. */
function buildHistory(log: ConversationLog, interpretations: RankingInput["interpretations"]) {
  return log.acceptedOutcomes.map((outcome) => {
    const explicit = interpretations.find((item) => item.id === outcome.interpretationId);
    const closest = interpretations
      .map((item) => ({
        item,
        similarity: overlap(
          `${outcome.title} ${outcome.summary}`,
          `${item.title} ${item.summary}`,
        ),
      }))
      .sort((left, right) => right.similarity - left.similarity)[0];

    return {
      id: outcome.id,
      interpretationId: explicit?.id ?? (closest?.similarity >= 0.25 ? closest.item.id : undefined),
      summary: `${outcome.title}. ${outcome.summary}`,
      terms: outcome.semanticTerms ?? outcome.title.split(/\s+/).filter(Boolean),
      accepted: true,
    };
  });
}

/**
 * Validates provider output and builds the minimal provider-neutral rank input.
 *
 * @throws ZodError for malformed shapes and Error for unsafe/ambiguous output.
 */
export function normalizeProviderAnalysis(
  value: unknown,
  log: ConversationLog,
): RankingInput {
  const analysis = providerAnalysisSchema.parse(value) as ProviderAnalysis;
  const interpretations: RankingInput["interpretations"] = [];
  const usedIds = new Set<string>();

  analysis.interpretations.forEach((candidate) => {
    const duplicate = interpretations.find(
      (item) =>
        (item.kind ?? "task") === (candidate.kind ?? "task") &&
        !haveConflictingFeatures(item.features, candidate.features) &&
        (normaliseText(item.title) === normaliseText(candidate.title) ||
          areEquivalentCandidates(item, candidate)),
    );
    if (duplicate) {
      duplicate.semanticTerms = [
        ...new Set([...duplicate.semanticTerms, ...candidate.semanticTerms]),
      ].slice(0, 10);
      duplicate.features = [...new Set([...duplicate.features, ...candidate.features])];
      return;
    }

    const baseId = slug(candidate.title);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    interpretations.push({
      ...candidate,
      id,
      kind: candidate.kind ?? "task",
      semanticTerms: [...new Set(candidate.semanticTerms.map((term) => term.trim()))],
      features: [...new Set(candidate.features.map((feature) => feature.toLowerCase()))],
    });
  });

  const instructionMessages = selectUserInstructionMessages(log.messages);
  const sourceText = instructionMessages.map((message) => normaliseText(message.text));
  const sourceMessageIds = new Set(instructionMessages.map((message) => message.id));
  const conversationAssessment = analysis.conversationAssessment
    ? { ...analysis.conversationAssessment }
    : {
        kind: "undetermined" as const,
        summary: "This legacy provider result did not include an actionability assessment.",
        evidenceMessageIds: [],
        knownFacts: [],
        unknowns: [],
      };
  conversationAssessment.evidenceMessageIds.forEach((messageId) => {
    if (!sourceMessageIds.has(messageId)) {
      throw new Error(
        `Conversation assessment evidence “${messageId}” is not grounded in a source message.`,
      );
    }
  });
  const expectedCandidateKind =
    conversationAssessment.kind === "actionable-task"
      ? "task"
      : conversationAssessment.kind === "ordinary-conversation"
        ? "conversation"
        : conversationAssessment.kind === "insufficient-context"
          ? "insufficient-context"
          : undefined;
  const compatibleInterpretations = expectedCandidateKind
    ? interpretations.filter((candidate) => candidate.kind === expectedCandidateKind)
    : interpretations;
  const requiresCompetingTasks =
    conversationAssessment.kind === "actionable-task" ||
    conversationAssessment.kind === "undetermined";
  if (interpretations.length < (requiresCompetingTasks ? 3 : 1)) {
    throw new Error(
      requiresCompetingTasks
        ? "The provider must return at least three genuinely distinct interpretations."
        : "The provider must return a grounded interpretation matching its conversation assessment.",
    );
  }
  if (expectedCandidateKind && compatibleInterpretations.length === 0) {
    throw new Error(
      `The provider must return a ${expectedCandidateKind} interpretation matching its conversation assessment.`,
    );
  }
  if (
    conversationAssessment.kind === "actionable-task" &&
    compatibleInterpretations.length < 3
  ) {
    throw new Error(
      "The provider must return at least three distinct task interpretations matching its conversation assessment.",
    );
  }
  (analysis.taskBoundaries ?? []).forEach((boundary) => {
    if (!sourceMessageIds.has(boundary.messageId)) {
      throw new Error(
        `Task boundary “${boundary.messageId}” is not grounded in a source message.`,
      );
    }
  });
  const constraintRules = analysis.constraints.flatMap((constraint) => {
    const groundedPhrases = constraint.phrases.filter((phrase) => {
      const target = normaliseText(phrase);
      return target.length > 0 && sourceText.some((message) => message.includes(target));
    });
    if (!groundedPhrases.length) {
      throw new Error(
        `Constraint “${constraint.id}” is not grounded in a source message.`,
      );
    }
    const constraintPhrases = groundedPhrases.filter(
      (phrase) => !isConversationalAcknowledgement(phrase),
    );
    if (!constraintPhrases.length) return [];
    if (
      !interpretations.some((candidate) =>
        candidate.features.some((feature) => feature.startsWith(`${constraint.dimension}:`)),
      )
    ) {
      throw new Error(
        `Constraint dimension “${constraint.dimension}” is missing from candidate features.`,
      );
    }
    const identityGroundedPhrases = constraintPhrases.filter(
      (phrase) =>
        hasGroundedLabel(constraint.label, phrase) ||
        hasGroundedConstraintIdentity(
          constraint.dimension,
          constraint.value,
          phrase,
        ),
    );
    if (!identityGroundedPhrases.length) {
      throw new Error(
        `Constraint “${constraint.id}” label and canonical identity are not grounded in its source phrase.`,
      );
    }
    const labelGrounded = identityGroundedPhrases.some((phrase) =>
      hasGroundedLabel(constraint.label, phrase),
    );
    // The exact source phrase is already validated and is safer than silently
    // removing an explicit instruction because a provider paraphrased its label.
    return [{
      ...constraint,
      phrases: identityGroundedPhrases,
      label: labelGrounded ? constraint.label : identityGroundedPhrases[0],
    }];
  });

  const messageTextById = new Map(
    instructionMessages.map((message) => [message.id, normaliseText(message.text)]),
  );
  const taskBoundaries = (analysis.taskBoundaries ?? []).filter((boundary) => {
    const boundaryText = messageTextById.get(boundary.messageId)!;
    return containsTaskRequest(boundaryText) && constraintRules.some(
      (constraint) =>
        constraint.mode === "require" &&
        (constraint.dimension === "topic" || constraint.dimension === "task") &&
        constraint.phrases.some((phrase) =>
          boundaryText.includes(normaliseText(phrase)),
        ),
    );
  });

  constraintRules.forEach((constraint, index) => {
    const contradiction = constraintRules.slice(index + 1).find(
      (other) =>
        other.dimension === constraint.dimension &&
        other.value === constraint.value &&
        other.mode !== constraint.mode &&
        other.phrases.some((phrase) => constraint.phrases.includes(phrase)),
    );
    if (contradiction) {
      throw new Error(
        `Provider returned contradictory constraints “${constraint.id}” and “${contradiction.id}”.`,
      );
    }
  });

  return {
    interpretations,
    constraintRules,
    history: buildHistory(log, interpretations),
    taskBoundaries,
    conversationAssessment,
  };
}
