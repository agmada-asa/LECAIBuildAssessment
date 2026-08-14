/** @file Provider-neutral contracts for versioned text embedding models. */

/** Stable metadata recorded with ranking runs and cached vectors. */
export type EmbeddingModel = {
  /** Adapter family, separate from the provider-specific model identifier. */
  provider: string;
  name: string;
  /** Immutable model or weights revision used to make every vector. */
  revision: string;
  /** Backwards-compatible persistence alias for `revision`. */
  version: string;
  dimensions: number;
  maxInputTokens: number;
  deployment: "local" | "hosted";
  purpose: "production" | "demo/test";
};

/** A vector carrying enough identity to make compatibility enforceable. */
export type ModelVector = {
  model: EmbeddingModel;
  vector: number[];
};

/** Minimal persisted vector shape used by migration/re-embedding planners. */
export type StoredEmbedding = ModelVector & { id: string };

/** Source offsets for one chunk contributing to an aggregate embedding. */
export type EmbeddingChunkProvenance = {
  chunkIndex: number;
  sourceStart: number;
  sourceEnd: number;
};

/** Privacy-safe operational counters; no text, credentials, or vectors. */
export type EmbeddingMetrics = {
  requests: number;
  retries: number;
  failures: number;
  embeddedInputs: number;
  cacheHits: number;
  cacheMisses: number;
  totalLatencyMs: number;
};

/**
 * Synchronous embedding contract used by the deterministic ranking core.
 *
 * Providers must use one model instance for messages, candidates, and history
 * in a run. Remote asynchronous adapters should populate a cache before calling
 * the ranker rather than making scoring depend on network availability.
 */
export interface EmbeddingProvider {
  readonly model: EmbeddingModel;
  embed(texts: readonly string[]): number[][];
}

/** Optional preparation phase for network-backed providers with a sync cache. */
export interface PreparableEmbeddingProvider extends EmbeddingProvider {
  prepare(texts: readonly string[]): Promise<void>;
  provenance?(text: string): EmbeddingChunkProvenance[];
  stats?(): EmbeddingMetrics;
}
