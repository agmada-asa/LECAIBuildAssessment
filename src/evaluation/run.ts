/** @file Reproducible evaluation runner for ranking and review-decision metrics. */

import { rankConversation } from "@/lib/ranking/engine";
import { DEFAULT_WEIGHTS } from "@/lib/ranking/scenarios";
import { EVALUATION_DATASET, type EvaluationCase } from "./dataset";

export type EvaluationMetrics = {
  cases: number;
  topOneCorrect: number;
  topOneAccuracy: number;
  reviewDecisionCorrect: number;
  reviewDecisionAccuracy: number;
  ambiguousCases: number;
  ambiguousEscalated: number;
  ambiguousEscalationRate: number;
  failures: Array<{
    id: string;
    expectedWinner: string;
    actualWinner: string;
    expectedHumanReview: boolean;
    actualHumanReview: boolean;
  }>;
};

/** Evaluates public ranking output without special-case corrections. */
export function evaluateDataset(
  dataset: EvaluationCase[] = EVALUATION_DATASET,
): EvaluationMetrics {
  let topOneCorrect = 0;
  let reviewDecisionCorrect = 0;
  let ambiguousEscalated = 0;
  const ambiguous = dataset.filter((item) => item.category === "genuine_ambiguity");
  const failures: EvaluationMetrics["failures"] = [];

  dataset.forEach((item) => {
    const result = rankConversation(
      item.input,
      item.conversation.messages,
      DEFAULT_WEIGHTS,
    );
    const winnerCorrect = result.ranking[0].id === item.expectedWinner;
    const reviewCorrect = result.uncertain === item.expectedHumanReview;
    if (winnerCorrect) topOneCorrect += 1;
    if (reviewCorrect) reviewDecisionCorrect += 1;
    if (item.category === "genuine_ambiguity" && result.uncertain) {
      ambiguousEscalated += 1;
    }
    if (!winnerCorrect || !reviewCorrect) {
      failures.push({
        id: item.id,
        expectedWinner: item.expectedWinner,
        actualWinner: result.ranking[0].id,
        expectedHumanReview: item.expectedHumanReview,
        actualHumanReview: result.uncertain,
      });
    }
  });

  return {
    cases: dataset.length,
    topOneCorrect,
    topOneAccuracy: topOneCorrect / dataset.length,
    reviewDecisionCorrect,
    reviewDecisionAccuracy: reviewDecisionCorrect / dataset.length,
    ambiguousCases: ambiguous.length,
    ambiguousEscalated,
    ambiguousEscalationRate: ambiguousEscalated / Math.max(ambiguous.length, 1),
    failures,
  };
}
