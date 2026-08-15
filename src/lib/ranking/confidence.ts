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
  minimumDecisiveTotal: 0.65,
  minimumDecisiveTotalMargin: 0.1,
  minimumDecisiveConstraintScore: 0.9,
  minimumDecisiveConstraintMatches: 2,
} as const;

export type TaskFamilyConfidence = {
  /** Combined relative confidence assigned to the winning task family. */
  confidence: number;
  /** Winning family confidence minus the strongest competing family. */
  margin: number;
};

/** Groups valid candidates using the same complete-linkage decision policy. */
function taskFamilies(
  ranking: RankedInterpretation[],
): RankedInterpretation[][] {
  const families: RankedInterpretation[][] = [];
  ranking
    .filter((candidate) => candidate.valid !== false)
    .forEach((candidate) => {
      const compatibleFamily = families.find((members) =>
        members.every((member) => belongsToSameTaskFamily(candidate, member)),
      );
      if (compatibleFamily) compatibleFamily.push(candidate);
      else families.push([candidate]);
    });
  return families;
}

/** Returns the representative of the strongest family opposing the winner. */
export function strongestCompetingTaskCandidate(
  ranking: RankedInterpretation[],
): RankedInterpretation | undefined {
  const families = taskFamilies(ranking);
  const winner = ranking.find((candidate) => candidate.valid !== false);
  const winnerFamily = winner
    ? families.find((family) => family.includes(winner))
    : undefined;
  return families
    .filter((family) => family !== winnerFamily)
    .sort(
      (left, right) =>
        right.reduce((total, candidate) => total + candidate.confidence, 0) -
        left.reduce((total, candidate) => total + candidate.confidence, 0),
    )[0]?.[0];
}

/** Returns true when candidates choose different values for one decision axis. */
function haveCanonicalConflict(
  left: RankedInterpretation,
  right: RankedInterpretation,
): boolean {
  const leftValues = new Map(
    left.features.map((feature) =>
      feature.toLowerCase().split(":", 2) as [string, string],
    ),
  );
  return right.features.some((feature) => {
    const [dimension, value] = feature.toLowerCase().split(":", 2);
    const leftValue = leftValues.get(dimension);
    return leftValue !== undefined && leftValue !== value;
  });
}

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
  // Conflicting canonical values represent decisions a reviewer may need to
  // distinguish, even when the surrounding task language is nearly identical.
  if (haveCanonicalConflict(left, right)) return false;
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
 * Invalid candidates do not contribute. A candidate joins a family only when
 * it is compatible with every existing member. This complete-linkage rule
 * prevents an underspecified candidate from bridging conflicting decisions.
 */
export function calculateTaskFamilyConfidence(
  ranking: RankedInterpretation[],
): TaskFamilyConfidence {
  const validCandidates = ranking.filter((candidate) => candidate.valid !== false);
  if (!validCandidates.length) return { confidence: 0, margin: 0 };

  const families = taskFamilies(ranking);

  const confidenceByFamily = families.map((members) =>
    members.reduce(
      (total, candidate) => total + candidate.confidence,
      0,
    ),
  );

  const leaderFamilyIndex = families.findIndex((members) =>
    members.includes(validCandidates[0]),
  );
  const confidence = Math.min(confidenceByFamily[leaderFamilyIndex] ?? 0, 1);
  const strongestAlternative = Math.max(
    0,
    ...confidenceByFamily.filter((_, familyIndex) => familyIndex !== leaderFamilyIndex),
  );

  return {
    confidence: round(confidence),
    margin: round(confidence - strongestAlternative),
  };
}
