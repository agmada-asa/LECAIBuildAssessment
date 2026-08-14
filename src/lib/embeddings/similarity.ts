/** @file Numerically safe, model-aware similarity functions for embeddings. */

import { areEmbeddingModelsCompatible } from "./lifecycle";
import type { ModelVector } from "./types";

/** Returns cosine similarity in `[0, 1]`, treating empty vectors as unrelated. */
export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length !== right.length || left.length === 0) return 0;

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(leftMagnitude * rightMagnitude)));
}

/** Compares tagged vectors and rejects cross-model/revision cosine mistakes. */
export function cosineSimilarityForModel(
  left: ModelVector,
  right: ModelVector,
): number {
  if (!areEmbeddingModelsCompatible(left.model, right.model)) {
    throw new Error("Cannot compare vectors produced by different embedding models.");
  }
  if (
    left.vector.length !== left.model.dimensions ||
    right.vector.length !== right.model.dimensions
  ) {
    throw new Error("Embedding vector dimensions do not match the recorded model.");
  }
  return cosineSimilarity(left.vector, right.vector);
}
