/**
 * @file Model-aware cache identity, compatibility, and re-embedding planning.
 *
 * These helpers keep migrations explicit: callers can enumerate stale records,
 * re-embed their source text with the target provider, and atomically replace
 * the old vectors. The planner never attempts to convert vectors numerically.
 */

import type { EmbeddingModel, StoredEmbedding } from "./types";

/** Normalizes operationally irrelevant whitespace without changing semantics. */
export function normalizeEmbeddingInput(input: string): string {
  return input.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** Complete namespace required for safe in-memory or persisted cache reuse. */
export function embeddingNamespace(model: EmbeddingModel): string {
  return [model.provider, model.name, model.revision, model.dimensions].join(":");
}

/** Namespaced key containing the normalized model input. */
export function cacheKey(model: EmbeddingModel, input: string): string {
  return `${embeddingNamespace(model)}:${normalizeEmbeddingInput(input)}`;
}

/** True only when two vectors inhabit the exact same model space. */
export function areEmbeddingModelsCompatible(
  left: EmbeddingModel,
  right: EmbeddingModel,
): boolean {
  return embeddingNamespace(left) === embeddingNamespace(right);
}

/** Describes which stored records require source-text re-embedding. */
export function planEmbeddingMigration(
  records: readonly StoredEmbedding[],
  target: EmbeddingModel,
): {
  compatibleIds: string[];
  reembedIds: string[];
  targetNamespace: string;
} {
  const compatibleIds: string[] = [];
  const reembedIds: string[] = [];
  records.forEach((record) => {
    (areEmbeddingModelsCompatible(record.model, target)
      ? compatibleIds
      : reembedIds
    ).push(record.id);
  });
  return {
    compatibleIds,
    reembedIds,
    targetNamespace: embeddingNamespace(target),
  };
}
