/**
 * @file Candidate-family confidence used by the human-review policy.
 *
 * Exact candidate scores remain separate for auditability. This module groups
 * provider-generated framing variants only for the decision boundary, keeping
 * that boundary stable when a provider emits several readings of one task.
 */

import { round } from "./scoring";
import { tokenOverlap } from "./text";
import type { RankedInterpretation } from "./types";

/** Review thresholds covered by labelled evaluations and task-family regressions. */
export const HUMAN_REVIEW_POLICY = {
  minimumTotal: 0.52,
  minimumRelativeConfidence: 0.55,
  minimumTopFamilyMargin: 0.12,
  minimumSharedTaskFeatures: 3,
  minimumSharedTaskFeatureRatio: 0.7,
  minimumSharedTitleRatio: 0.25,
} as const;

export type TaskFamilyConfidence = {
  /** Combined relative confidence assigned to the winning task family. */
  confidence: number;
  /** Winning family confidence minus the strongest competing family. */
  margin: number;
};

/**
 * Detects provider variants that describe the same well-specified task.
 *
 * Requiring overlap in both the task label and a rich canonical feature set
 * prevents a lone shared topic from hiding genuine format or deliverable
 * ambiguity.
 */
function belongsToSameTaskFamily(
  left: RankedInterpretation,
  right: RankedInterpretation,
): boolean {
  const leftFeatures = new Set(left.features.map((feature) => feature.toLowerCase()));
  const rightFeatures = new Set(right.features.map((feature) => feature.toLowerCase()));
  const shared = [...leftFeatures].filter((feature) => rightFeatures.has(feature)).length;
  const smallerFeatureCount = Math.min(leftFeatures.size, rightFeatures.size);

  return (
    shared >= HUMAN_REVIEW_POLICY.minimumSharedTaskFeatures &&
    shared / Math.max(smallerFeatureCount, 1) >=
      HUMAN_REVIEW_POLICY.minimumSharedTaskFeatureRatio &&
    tokenOverlap(left.title, right.title) >= HUMAN_REVIEW_POLICY.minimumSharedTitleRatio
  );
}

/**
 * Aggregates exact-candidate confidence into stable task-family confidence.
 *
 * Invalid candidates do not contribute. Families are transitive, so three
 * closely related framings remain together even when the first and third use
 * somewhat different language.
 */
export function calculateTaskFamilyConfidence(
  ranking: RankedInterpretation[],
): TaskFamilyConfidence {
  const validCandidates = ranking.filter((candidate) => candidate.valid !== false);
  if (!validCandidates.length) return { confidence: 0, margin: 0 };

  const parents = validCandidates.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const parent = parents[index];
      parents[index] = root;
      index = parent;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  validCandidates.forEach((candidate, leftIndex) => {
    validCandidates.slice(leftIndex + 1).forEach((other, offset) => {
      if (belongsToSameTaskFamily(candidate, other)) {
        union(leftIndex, leftIndex + offset + 1);
      }
    });
  });

  const confidenceByFamily = new Map<number, number>();
  validCandidates.forEach((candidate, index) => {
    const root = find(index);
    confidenceByFamily.set(root, (confidenceByFamily.get(root) ?? 0) + candidate.confidence);
  });

  const leaderIndex = validCandidates.indexOf(ranking[0]);
  if (leaderIndex < 0) return { confidence: 0, margin: 0 };
  const leaderRoot = find(leaderIndex);
  const confidence = Math.min(confidenceByFamily.get(leaderRoot) ?? 0, 1);
  const strongestAlternative = Math.max(
    0,
    ...[...confidenceByFamily]
      .filter(([root]) => root !== leaderRoot)
      .map(([, familyConfidence]) => familyConfidence),
  );

  return {
    confidence: round(confidence),
    margin: round(confidence - strongestAlternative),
  };
}
