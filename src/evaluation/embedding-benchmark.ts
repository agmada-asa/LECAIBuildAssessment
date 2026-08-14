/**
 * @file Reproducible report contracts and release gates for embedding trials.
 *
 * Real trained-model values must be supplied by the separately run integration
 * evaluation. This module intentionally cannot manufacture or default them.
 */

export type EmbeddingBenchmarkMetrics = {
  topOneAccuracy: number;
  duplicateCandidateRate: number;
  falseHumanReviewRate: number;
  constraintEvidenceCorrectness: number;
  historicalRetrievalQuality: number;
  p95LatencyMs: number;
};

export type EmbeddingBenchmarkReport = {
  status: "complete" | "pending_credentials";
  model: string;
  revision: string;
  metrics: EmbeddingBenchmarkMetrics | null;
  tradeoffs: {
    cost: string;
    privacy: string;
    licensing: string;
    deployment: string;
  };
};

/** Rollout gates evaluated against both absolute limits and the committed baseline. */
export const EMBEDDING_ACCEPTANCE_THRESHOLDS = {
  minimumTopOneAccuracy: 0.8,
  maximumAccuracyRegression: 0.01,
  maximumDuplicateCandidateRate: 0.15,
  maximumFalseHumanReviewRate: 0.15,
  minimumConstraintEvidenceCorrectness: 0.95,
  minimumHistoricalRetrievalQuality: 0.75,
} as const;

/** Creates an honest placeholder until the pinned hosted model is actually run. */
export function createPendingEmbeddingReport(
  model: string,
  revision: string,
): EmbeddingBenchmarkReport {
  return {
    status: "pending_credentials",
    model,
    revision,
    metrics: null,
    tradeoffs: {
      cost: "Pending endpoint pricing and measured request volume.",
      privacy: "Hosted processing requires retention, region, and data-sharing review.",
      licensing: "Confirm the selected endpoint/model terms before rollout.",
      deployment: "OpenAI-compatible hosted API; unavailable offline.",
    },
  };
}

/** Compares a trained trial with the feature-hash baseline and fixed safety gates. */
export function assessEmbeddingRollout(
  trained: EmbeddingBenchmarkMetrics,
  baseline: EmbeddingBenchmarkMetrics,
): {
  eligible: boolean;
  reasons: string[];
  rollbackCriteria: typeof EMBEDDING_ACCEPTANCE_THRESHOLDS;
} {
  const reasons: string[] = [];
  const thresholds = EMBEDDING_ACCEPTANCE_THRESHOLDS;
  if (
    trained.topOneAccuracy < thresholds.minimumTopOneAccuracy ||
    trained.topOneAccuracy <
      baseline.topOneAccuracy - thresholds.maximumAccuracyRegression
  ) {
    reasons.push("Top-one accuracy does not clear the baseline gate.");
  }
  if (trained.duplicateCandidateRate > thresholds.maximumDuplicateCandidateRate) {
    reasons.push("Duplicate-candidate rate exceeds the rollout gate.");
  }
  if (trained.falseHumanReviewRate > thresholds.maximumFalseHumanReviewRate) {
    reasons.push("False human-review rate exceeds the rollout gate.");
  }
  if (
    trained.constraintEvidenceCorrectness <
    thresholds.minimumConstraintEvidenceCorrectness
  ) {
    reasons.push("Constraint evidence correctness is below the safety gate.");
  }
  if (
    trained.historicalRetrievalQuality <
    thresholds.minimumHistoricalRetrievalQuality
  ) {
    reasons.push("Historical retrieval quality is below the rollout gate.");
  }
  return { eligible: reasons.length === 0, reasons, rollbackCriteria: thresholds };
}
