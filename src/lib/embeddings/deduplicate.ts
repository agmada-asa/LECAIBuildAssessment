/**
 * @file Provider-neutral semantic candidate consolidation.
 *
 * Embeddings augment, rather than replace, canonical feature conflicts and a
 * transparent lexical check. Candidates choosing different values for the same
 * feature dimension are always preserved even when their wording is similar.
 */

import type { Interpretation } from "@/lib/ranking/types";
import { tokenOverlap } from "@/lib/ranking/text";

import { candidateEmbeddingInput } from "./inputs";
import { cosineSimilarityForModel } from "./similarity";
import type { EmbeddingProvider, PreparableEmbeddingProvider } from "./types";

export type DuplicateCandidate = {
  keptId: string;
  mergedId: string;
  cosineSimilarity: number;
  lexicalSimilarity: number;
};

/** True when candidates make mutually exclusive decisions on one dimension. */
function haveCanonicalConflict(
  left: Interpretation,
  right: Interpretation,
): boolean {
  const leftFeatures = new Map(
    left.features.map((feature) => feature.toLowerCase().split(":", 2) as [string, string]),
  );
  return right.features.some((feature) => {
    const [dimension, value] = feature.toLowerCase().split(":", 2);
    const leftValue = leftFeatures.get(dimension);
    return leftValue !== undefined && leftValue !== value;
  });
}

/**
 * Consolidates near-identical interpretations after embeddings are available.
 *
 * Both semantic and lexical thresholds must pass. This conservative policy
 * avoids merging candidates because of repeated tool names alone.
 */
export async function consolidateSemanticDuplicates(
  candidates: readonly Interpretation[],
  provider: EmbeddingProvider,
  thresholds: { cosine: number; lexical: number } = {
    cosine: 0.92,
    lexical: 0.62,
  },
): Promise<{ candidates: Interpretation[]; duplicates: DuplicateCandidate[] }> {
  const inputs = candidates.map(candidateEmbeddingInput);
  const preparable = provider as Partial<PreparableEmbeddingProvider>;
  if (preparable.prepare) await preparable.prepare(inputs);
  const vectors = provider.embed(inputs);
  const kept: Interpretation[] = [];
  const keptIndexes: number[] = [];
  const duplicates: DuplicateCandidate[] = [];

  candidates.forEach((candidate, index) => {
    const duplicateIndex = kept.findIndex((existing, keptIndex) => {
      if (haveCanonicalConflict(existing, candidate)) return false;
      const lexical = tokenOverlap(inputs[keptIndexes[keptIndex]], inputs[index]);
      const cosine = cosineSimilarityForModel(
        { model: provider.model, vector: vectors[keptIndexes[keptIndex]] },
        { model: provider.model, vector: vectors[index] },
      );
      return lexical >= thresholds.lexical && cosine >= thresholds.cosine;
    });
    if (duplicateIndex < 0) {
      kept.push({
        ...candidate,
        semanticTerms: [...candidate.semanticTerms],
        features: [...candidate.features],
      });
      keptIndexes.push(index);
      return;
    }

    const target = kept[duplicateIndex];
    const targetIndex = keptIndexes[duplicateIndex];
    const lexicalSimilarity = tokenOverlap(inputs[targetIndex], inputs[index]);
    const cosineSimilarity = cosineSimilarityForModel(
      { model: provider.model, vector: vectors[targetIndex] },
      { model: provider.model, vector: vectors[index] },
    );
    target.semanticTerms = [
      ...new Set([...target.semanticTerms, ...candidate.semanticTerms]),
    ];
    target.features = [...new Set([...target.features, ...candidate.features])];
    duplicates.push({
      keptId: target.id,
      mergedId: candidate.id,
      cosineSimilarity,
      lexicalSimilarity,
    });
  });

  return { candidates: kept, duplicates };
}
