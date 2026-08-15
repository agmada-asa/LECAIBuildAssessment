/** @file Integrity checks for the imported actionability evaluation corpus. */

import { describe, expect, it } from "vitest";

import { ACTIONABILITY_EVALUATION_DATASET } from "./actionability-dataset";

describe("actionability evaluation dataset", () => {
  it("contains the 20 unique labelled source cases without blind duplicates", () => {
    expect(ACTIONABILITY_EVALUATION_DATASET).toHaveLength(20);
    expect(new Set(ACTIONABILITY_EVALUATION_DATASET.map((item) => item.id)).size).toBe(20);
    expect(
      Object.fromEntries(
        ["easy", "medium", "hard", "impossible", "random"].map((difficulty) => [
          difficulty,
          ACTIONABILITY_EVALUATION_DATASET.filter(
            (item) => item.difficulty === difficulty,
          ).length,
        ]),
      ),
    ).toEqual({ easy: 4, medium: 4, hard: 4, impossible: 4, random: 4 });
  });

  it("requires abstention for every impossible and incoherent case", () => {
    const mustAbstain = ACTIONABILITY_EVALUATION_DATASET.filter((item) =>
      ["impossible", "random"].includes(item.difficulty),
    );

    expect(mustAbstain.every((item) => item.expectedAssessment === "insufficient-context"))
      .toBe(true);
  });
});
