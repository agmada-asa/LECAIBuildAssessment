/** @file Regression gate for the published labelled evaluation metrics. */

import { describe, expect, it } from "vitest";

import { EVALUATION_DATASET } from "./dataset";
import { evaluateDataset } from "./run";

describe("evaluation dataset", () => {
  it("contains at least twenty labelled conversations across every required category", () => {
    expect(EVALUATION_DATASET.length).toBeGreaterThanOrEqual(20);
    expect(new Set(EVALUATION_DATASET.map((item) => item.category))).toEqual(
      new Set([
        "clear_intent",
        "genuine_ambiguity",
        "late_contradiction",
        "gradual_reframe",
        "synonym",
        "unrelated_replacement",
        "weak_evidence",
        "quoted_or_misleading",
        "negated_instruction",
      ]),
    );
  });

  it("reproduces the published winner and escalation metrics", () => {
    const metrics = evaluateDataset();

    expect(metrics.failures).toEqual([]);
    expect(metrics.topOneAccuracy).toBe(1);
    expect(metrics.reviewDecisionAccuracy).toBe(1);
    expect(metrics.ambiguousEscalationRate).toBe(1);
  });
});
