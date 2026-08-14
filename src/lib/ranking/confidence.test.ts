/** @file Boundary tests for machine-readable review policy and clarification. */

import { describe, expect, it } from "vitest";

import { evaluateHumanReview, generateClarificationQuestion } from "./engine";
import type { RankedInterpretation } from "./types";

function candidate(
  id: string,
  total: number,
  confidence: number,
  features: string[],
): RankedInterpretation & { features: string[] } {
  return {
    id,
    rank: 1,
    title: id === "dashboard" ? "Build a dashboard" : "Send a weekly report",
    summary: id,
    features,
    semanticTerms: [],
    signals: { semantic: total, constraints: total, history: total },
    total,
    confidence,
    evidence: [],
    explanation: "",
  };
}

describe("evaluateHumanReview", () => {
  it("distinguishes weak total evidence", () => {
    expect(
      evaluateHumanReview([
        candidate("dashboard", 0.51, 0.7, []),
        candidate("report", 0.4, 0.2, []),
      ]),
    ).toMatchObject({ code: "weak_evidence" });
  });

  it("distinguishes low relative leader confidence", () => {
    expect(
      evaluateHumanReview([
        candidate("dashboard", 0.7, 0.54, []),
        candidate("report", 0.5, 0.3, []),
      ]),
    ).toMatchObject({ code: "low_relative_confidence" });
  });

  it("distinguishes a close top-two margin", () => {
    expect(
      evaluateHumanReview([
        candidate("dashboard", 0.8, 0.58, []),
        candidate("report", 0.75, 0.48, []),
      ]),
    ).toMatchObject({ code: "close_candidates" });
  });
});

describe("generateClarificationQuestion", () => {
  it("uses the actual feature disagreement between the top candidates", () => {
    const question = generateClarificationQuestion(
      candidate("dashboard", 0.8, 0.52, ["format:dashboard", "cadence:weekly"]),
      candidate("report", 0.78, 0.48, ["format:report", "cadence:weekly"]),
    );

    expect(question).toBe("Should the format be dashboard or report?");
  });

  it("does not ask users to distinguish paraphrases without a canonical decision", () => {
    const question = generateClarificationQuestion(
      candidate("dashboard", 0.8, 0.52, []),
      candidate("report", 0.78, 0.48, []),
    );

    expect(question).toBeUndefined();
  });
});
