/** @file Release regression for raw-log provider grounding and ranking metrics. */

import { describe, expect, it } from "vitest";

import {
  evaluateProviderInclusive,
  PROVIDER_EVALUATION_DATASET,
} from "./provider-inclusive";

describe("provider-inclusive evaluation", () => {
  it("covers every audited raw-log category", () => {
    expect(new Set(PROVIDER_EVALUATION_DATASET.map((item) => item.category))).toEqual(
      new Set([
        "open_set",
        "format_negation",
        "role_bearing",
        "deferred_resumption",
        "no_valid_candidate",
      ]),
    );
  });

  it("keeps generated candidates grounded without treating provider failure as review", () => {
    expect(evaluateProviderInclusive()).toEqual({
      cases: 5,
      generationFailures: 1,
      candidateGroundingRate: 1,
      duplicateCandidateRate: 0,
      topOneAccuracy: 1,
      reviewDecisionAccuracy: 0.8,
      falseHumanReviewRate: 0,
    });
  });
});
