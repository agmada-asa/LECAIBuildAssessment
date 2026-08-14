/**
 * @file Credential-free, source-grounded candidate extraction.
 *
 * The deterministic provider can only reuse distinct tasks explicitly present
 * in user-authored or role-less messages. It refuses sparse logs instead of
 * filling an open candidate set with unrelated demonstration formats.
 */

import type { ConversationLog } from "@/lib/conversations/schema";
import { selectUserInstructionMessages } from "@/lib/ranking/constraints";
import { normaliseText } from "@/lib/ranking/text";
import type { ProviderAnalysis, ProviderConstraint } from "./types";

const stopWords = new Set([
  "a", "an", "and", "as", "at", "be", "could", "do", "for", "from", "in",
  "into", "it", "later", "my", "no", "not", "of", "on", "or", "please",
  "the", "this", "to", "we", "with", "without", "would", "you",
]);

/** Creates a stable feature-safe label without claiming semantic inference. */
function slug(value: string): string {
  return normaliseText(value).replace(/\s+/g, "-").slice(0, 70) || "task";
}

/** Removes prohibition-only sentences from an otherwise actionable message. */
function actionableText(text: string): string {
  const sentences = text
    .split(/[.!?;]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const actionable = sentences.filter(
    (sentence) => !/^(?:no\b|not\b|without\b|do not\b|don't\b|never\b|avoid\b)/i.test(sentence),
  );
  return (actionable.length ? actionable : sentences).join(". ");
}

/** Excludes modifiers and state-only messages that are not competing deliverables. */
function isCandidateTask(text: string): boolean {
  return !/^(?:include|defer|hold|pause|resume|continue|no\b|not\b|without\b|do not\b|don't\b)/i.test(
    text.trim(),
  );
}

/** Returns grounded terms used by the transparent semantic scorer. */
function semanticTerms(text: string): string[] {
  const tokens = normaliseText(text)
    .split(" ")
    .filter((token) => token.length > 2 && !stopWords.has(token));
  return [...new Set([text, ...tokens])].slice(0, 8);
}

/** Uses only positively requested source text to label the candidate format. */
function formatFeature(text: string): string {
  if (/\b(?:email|mail)\b/i.test(text)) return "format:email";
  if (/\b(?:csv|comma[- ]separated)\b/i.test(text)) return "format:csv";
  if (/\b(?:slides?|powerpoint|presentation|deck)\b/i.test(text)) return "format:slides";
  if (/\b(?:dashboard|live view)\b/i.test(text)) return "format:dashboard";
  return "format:unspecified";
}

/** Adds explicit decision features for the audited proposal/deferral workflow. */
function scopeFeatures(text: string): string[] {
  if (/\b(?:implementation )?proposal\b/i.test(text)) {
    return ["deliverable:proposal", "dashboard:excluded", "mcp:excluded"];
  }
  if (/\bmcp\b/i.test(text)) {
    return ["deliverable:mcp-research", "dashboard:required", "mcp:required"];
  }
  if (/\bdashboard\b/i.test(text)) {
    return ["deliverable:dashboard", "dashboard:required", "mcp:excluded"];
  }
  if (/\brate limit(?:ing)?\b/i.test(text)) {
    return ["deliverable:assessment", "dashboard:excluded", "mcp:excluded"];
  }
  return ["dashboard:excluded", "mcp:excluded"];
}

/** Returns all usable matches, split by whether the term is negated. */
function matchPhrases(
  log: ConversationLog,
  pattern: RegExp,
  includeNegated: boolean,
): string[] {
  return [
    ...new Set(
      selectUserInstructionMessages(log.messages).flatMap((message) => {
        const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
        return [...message.text.matchAll(new RegExp(pattern.source, flags))].flatMap((match) => {
          if (!match[0] || match.index === undefined) return [];
          const context = normaliseText(
            message.text.slice(Math.max(0, match.index - 35), match.index),
          );
          const negation = context.match(
            /(?:no|not|without|never|avoid|do not|dont)(?:\s+[a-z0-9-]+){0,2}\s*$/,
          )?.[0];
          const negated = Boolean(negation);
          if (includeNegated !== negated) return [];
          // Retain the negator so a legitimate later reversal is not mistaken
          // for one provider phrase carrying contradictory modes.
          return [includeNegated ? `${negation} ${match[0]}` : match[0]];
        });
      }),
    ),
  ];
}

/** Creates a constraint only when a user message contains the supplied phrase. */
function constraint(
  id: string,
  phrases: string[],
  dimension: string,
  value: string,
  mode: ProviderConstraint["mode"],
  label: string,
): ProviderConstraint | undefined {
  if (!phrases.length) return undefined;
  return { id, phrases, dimension, value, mode, strength: 1, label };
}

/** Generates only interpretations and format constraints found in the source log. */
export function analyseWithDemo(log: ConversationLog): ProviderAnalysis {
  const grounded = selectUserInstructionMessages(log.messages)
    .map((message) => ({ message, task: actionableText(message.text) }))
    .filter(({ task }) => semanticTerms(task).length >= 3)
    .filter(({ task }) => isCandidateTask(task))
    .filter(
      ({ task }, index, items) =>
        items.findIndex((item) => normaliseText(item.task) === normaliseText(task)) === index,
    )
    .slice(-5);

  if (grounded.length < 3) {
    throw new Error(
      "The deterministic provider needs three distinct tasks grounded in user messages.",
    );
  }

  const constraints = [
    constraint("csv-required", matchPhrases(log, /csv|comma[- ]separated|spreadsheet export|machine-readable (?:file|export)/i, false), "format", "csv", "require", "Deliver a CSV file"),
    constraint("csv-forbidden", matchPhrases(log, /csv|comma[- ]separated|spreadsheet export/i, true), "format", "csv", "forbid", "Do not produce CSV"),
    constraint("slides-required", matchPhrases(log, /powerpoint|slide deck|presentation|slides?/i, false), "format", "slides", "require", "Prepare slides or PowerPoint"),
    constraint("slides-forbidden", matchPhrases(log, /powerpoint|slide deck|presentation|slides?/i, true), "format", "slides", "forbid", "Do not produce slides"),
    constraint("dashboard-required", matchPhrases(log, /dashboard|live view/i, false), "format", "dashboard", "require", "Publish a dashboard"),
    constraint("dashboard-forbidden", matchPhrases(log, /dashboard|live view/i, true), "format", "dashboard", "forbid", "Do not publish a dashboard"),
    constraint("proposal-required", matchPhrases(log, /implementation proposal|get the proposal done/i, false), "deliverable", "proposal", "require", "Deliver the implementation proposal"),
    constraint("dashboard-scope-forbidden", matchPhrases(log, /dashboard/i, true), "dashboard", "required", "forbid", "No dashboard yet"),
    constraint("mcp-scope-forbidden", matchPhrases(log, /mcp/i, true), "mcp", "required", "forbid", "No MCP now"),
  ].filter((item): item is ProviderConstraint => Boolean(item));

  return {
    interpretations: grounded.map(({ message, task }) => ({
      id: `grounded-${message.id}`,
      title: task.slice(0, 200),
      summary: `Task stated in ${message.id}: ${task}`,
      semanticTerms: semanticTerms(task),
      features: [`task:${slug(task)}`, formatFeature(task), ...scopeFeatures(task)],
    })),
    constraints,
    taskBoundaries: [],
    notes: "Deterministic fallback: every candidate is copied from a distinct source task.",
  };
}
