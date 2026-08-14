/**
 * @file Provider-neutral input templates shared across embedding use cases.
 *
 * Short structural labels distinguish the requested task from incidental tool
 * mentions. Conversation-state decisions (negation, deferral, supersession,
 * resumption) intentionally remain in the constraint engine, not these strings.
 */

import type { ConversationMessage, HistoricalTask, Interpretation } from "@/lib/ranking/types";

/** Constructs the one canonical representation of a candidate interpretation. */
export function candidateEmbeddingInput(candidate: Interpretation): string {
  return [
    "Candidate task:",
    candidate.title,
    candidate.summary,
    `Meaning: ${candidate.semanticTerms.join("; ")}`,
  ].join(" ");
}

/** Constructs a message input while retaining source identity outside the text. */
export function messageEmbeddingInput(message: Pick<ConversationMessage, "text">): string {
  return `User task context: ${message.text}`;
}

/** Constructs the same task-shaped representation for accepted outcomes. */
export function outcomeEmbeddingInput(
  outcome: Pick<HistoricalTask, "summary" | "terms">,
): string {
  return `Accepted task: ${outcome.summary} Meaning: ${outcome.terms.join("; ")}`;
}
