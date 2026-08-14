/** @file Deterministic contracts for embedding-assisted candidate consolidation. */

import { describe, expect, it } from "vitest";

import type { Interpretation } from "@/lib/ranking/types";
import { LocalEmbeddingProvider } from "./provider";
import { consolidateSemanticDuplicates } from "./deduplicate";

function candidate(
  id: string,
  title: string,
  features: string[],
): Interpretation {
  return {
    id,
    title,
    summary: `${title} for the finance team`,
    semanticTerms: title.split(" "),
    features,
  };
}

describe("semantic duplicate consolidation", () => {
  it("merges paraphrases before confidence scoring", async () => {
    const result = await consolidateSemanticDuplicates(
      [
        candidate("proposal-only", "Write concise proposal", ["deliverable:proposal"]),
        candidate("combined-proposal", "Write concise proposal", ["deliverable:proposal"]),
        candidate("dashboard", "Build live dashboard", ["deliverable:dashboard"]),
      ],
      new LocalEmbeddingProvider(),
    );

    expect(result.candidates.map((item) => item.id)).toEqual([
      "proposal-only",
      "dashboard",
    ]);
    expect(result.duplicates).toEqual([
      expect.objectContaining({
        keptId: "proposal-only",
        mergedId: "combined-proposal",
      }),
    ]);
  });

  it("preserves similar wording when canonical features conflict", async () => {
    const result = await consolidateSemanticDuplicates(
      [
        candidate("proposal-now", "Prepare finance proposal", ["timing:now"]),
        candidate("proposal-later", "Prepare finance proposal", ["timing:later"]),
      ],
      new LocalEmbeddingProvider(),
    );

    expect(result.candidates).toHaveLength(2);
    expect(result.duplicates).toEqual([]);
  });
});
