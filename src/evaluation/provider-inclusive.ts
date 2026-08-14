/** @file End-to-end evaluation from raw logs through provider generation and ranking. */

import type { ConversationLog } from "@/lib/conversations/schema";
import { analyseWithDemo } from "@/lib/providers/demo";
import { normalizeProviderAnalysis } from "@/lib/providers/normalize";
import type { ProviderAnalysis } from "@/lib/providers/types";
import { rankConversation } from "@/lib/ranking/engine";
import { DEFAULT_WEIGHTS } from "@/lib/ranking/scenarios";
import { normaliseText, tokenOverlap } from "@/lib/ranking/text";

export type ProviderEvaluationCase = {
  id: string;
  category:
    | "open_set"
    | "format_negation"
    | "role_bearing"
    | "deferred_resumption"
    | "no_valid_candidate";
  conversation: ConversationLog;
  expectedWinner?: RegExp;
  expectedReview: boolean;
};

export type ProviderInclusiveMetrics = {
  cases: number;
  generationFailures: number;
  candidateGroundingRate: number;
  duplicateCandidateRate: number;
  topOneAccuracy: number;
  reviewDecisionAccuracy: number;
  falseHumanReviewRate: number;
};

/** Creates one raw canonical log without a hand-authored candidate catalogue. */
function log(
  id: string,
  messages: Array<string | { text: string; author: string }>,
): ConversationLog {
  return {
    conversationId: id,
    userId: "provider-evaluation-user",
    domain: { name: "provider-evaluation" },
    messages: messages.map((message, index) => ({
      id: `M${index + 1}`,
      text: typeof message === "string" ? message : message.text,
      ...(typeof message === "string" ? {} : { author: message.author }),
      timestamp: `2026-08-14T10:${String(index).padStart(2, "0")}:00.000Z`,
    })),
    acceptedOutcomes: [],
  };
}

/** Raw-log cases that exercise the audited provider path rather than only the scorer. */
export const PROVIDER_EVALUATION_DATASET: ProviderEvaluationCase[] = [
  {
    id: "arbitrary-domain-switch",
    category: "open_set",
    conversation: log("arbitrary-domain-switch", [
      "Book a dentist appointment for next Tuesday.",
      "Compare flights from London to Lisbon.",
      "Write the customer an apology email for the delay.",
    ]),
    expectedWinner: /apology email/i,
    expectedReview: true,
  },
  {
    id: "explicit-format-negation",
    category: "format_negation",
    conversation: log("explicit-format-negation", [
      "Book a dentist appointment for next Tuesday.",
      "Compare flights from London to Lisbon.",
      "No CSV, no slides, no dashboard. Write the apology email.",
    ]),
    expectedWinner: /apology email/i,
    expectedReview: false,
  },
  {
    id: "role-bearing-log",
    category: "role_bearing",
    conversation: log("role-bearing-log", [
      { text: "Book a dentist appointment.", author: "user" },
      { text: "Compare flights to Lisbon.", author: "user" },
      { text: "Write the apology email.", author: "user" },
      { text: "Publish a dashboard instead.", author: "assistant" },
    ]),
    expectedWinner: /apology email/i,
    expectedReview: true,
  },
  {
    id: "finance-resumption",
    category: "deferred_resumption",
    conversation: log("finance-resumption", [
      "We eventually need a finance monitoring dashboard.",
      "First assess rate limiting for the ingestion service.",
      "Write one concise implementation proposal for rate limiting.",
      "No dashboard yet; defer that work until the proposal is approved.",
      "Include rollout, retry budgets, and ownership in the proposal.",
      "For the deferred dashboard, could MCP help later?",
      "No MCP now, just get the proposal done.",
    ]),
    expectedWinner: /implementation proposal/i,
    expectedReview: false,
  },
  {
    id: "no-valid-open-set",
    category: "no_valid_candidate",
    conversation: log("no-valid-open-set", [
      "Prepare the usual update.",
      "Use whichever format works.",
    ]),
    expectedReview: true,
  },
];

/** Runs raw logs through candidate generation, normalization, and public ranking policy. */
export function evaluateProviderInclusive(
  dataset: ProviderEvaluationCase[] = PROVIDER_EVALUATION_DATASET,
  provider: (conversation: ConversationLog) => ProviderAnalysis = analyseWithDemo,
): ProviderInclusiveMetrics {
  let generationFailures = 0;
  let grounded = 0;
  let generated = 0;
  let duplicates = 0;
  let topOneCorrect = 0;
  let reviewCorrect = 0;
  let falseHumanReviews = 0;
  let clearCases = 0;

  dataset.forEach((item) => {
    try {
      const input = normalizeProviderAnalysis(provider(item.conversation), item.conversation);
      const result = rankConversation(input, item.conversation.messages, DEFAULT_WEIGHTS);
      const sourceText = item.conversation.messages
        .filter((message) => !/^(?:assistant|system|tool|developer)$/i.test(message.author ?? ""))
        .map((message) => normaliseText(message.text));
      input.interpretations.forEach((candidate) => {
        generated += 1;
        if (sourceText.some((text) => tokenOverlap(text, candidate.title) >= 0.45)) grounded += 1;
      });
      const canonical = new Set(
        input.interpretations.map((candidate) => normaliseText(candidate.title)),
      );
      duplicates += input.interpretations.length - canonical.size;
      if (item.expectedWinner?.test(result.ranking[0].title)) topOneCorrect += 1;
      if (result.uncertain === item.expectedReview) reviewCorrect += 1;
      if (!item.expectedReview) {
        clearCases += 1;
        if (result.uncertain) falseHumanReviews += 1;
      }
    } catch {
      generationFailures += 1;
      if (item.expectedReview) reviewCorrect += 1;
    }
  });

  const winnerCases = dataset.filter((item) => item.expectedWinner).length;
  return {
    cases: dataset.length,
    generationFailures,
    candidateGroundingRate: grounded / Math.max(generated, 1),
    duplicateCandidateRate: duplicates / Math.max(generated, 1),
    topOneAccuracy: topOneCorrect / Math.max(winnerCases, 1),
    reviewDecisionAccuracy: reviewCorrect / dataset.length,
    falseHumanReviewRate: falseHumanReviews / Math.max(clearCases, 1),
  };
}
