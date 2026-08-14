/**
 * @file Versioned, private, offline embedding provider with bounded caching.
 *
 * The model canonicalises a deliberately small set of common task paraphrases,
 * then projects tokens and adjacent phrases into a fixed feature-hash vector.
 * It is not a general neural model, but it provides real vector embeddings and
 * cosine geometry without downloading weights or sending user text elsewhere.
 */

import type { EmbeddingModel, EmbeddingProvider } from "./types";
import { cacheKey } from "./lifecycle";

const MODEL: EmbeddingModel = {
  provider: "resolve-demo",
  name: "resolve-local-feature-hash",
  revision: "1.0.0",
  version: "1.0.0",
  dimensions: 256,
  maxInputTokens: 8_192,
  deployment: "local",
  purpose: "demo/test",
};

const CANONICAL_TERMS: Record<string, string> = {
  deck: "presentation",
  decks: "presentation",
  powerpoint: "presentation",
  ppt: "presentation",
  pptx: "presentation",
  presentation: "presentation",
  presentations: "presentation",
  slide: "presentation",
  slides: "presentation",
  comma: "csv",
  spreadsheet: "table",
  spreadsheets: "table",
  workbook: "table",
  workbooks: "table",
  dashboard: "dashboard",
  dashboards: "dashboard",
  visualisation: "dashboard",
  visualization: "dashboard",
  mail: "email",
  memo: "document",
  report: "document",
  reports: "document",
};

/** Maps arbitrary UTF-8 text to a stable unsigned integer. */
function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** Produces canonical lexical features used by the local vector model. */
function features(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .map((token) => CANONICAL_TERMS[token] ?? token.replace(/(ing|ed|s)$/i, ""));
  const adjacent = tokens.slice(0, -1).map((token, index) => `${token}_${tokens[index + 1]}`);
  return [...tokens, ...adjacent];
}

/** Creates a normalised vector from canonical token and bigram features. */
function vectorise(text: string): number[] {
  const vector = Array<number>(MODEL.dimensions).fill(0);
  features(text).forEach((feature) => {
    vector[hash(feature) % MODEL.dimensions] += feature.includes("_") ? 0.7 : 1;
  });
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value ** 2, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

/** Deterministic feature hash for demos/tests; it is not a trained model. */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model = MODEL;

  /** Embeds every input with the exact same model and feature space. */
  embed(texts: readonly string[]): number[][] {
    return texts.map(vectorise);
  }
}

/** Bounded least-recently-used cache keyed by model identity and exact text. */
export class CachingEmbeddingProvider implements EmbeddingProvider {
  readonly model: EmbeddingModel;
  private readonly cache = new Map<string, number[]>();
  private hitCount = 0;
  private missCount = 0;

  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly maximumEntries = 2_000,
  ) {
    this.model = inner.model;
  }

  /** Reuses vectors and evicts the least recently accessed entry when full. */
  embed(texts: readonly string[]): number[][] {
    return texts.map((input) => {
      const key = cacheKey(this.model, input);
      const existing = this.cache.get(key);
      if (existing) {
        this.hitCount += 1;
        this.cache.delete(key);
        this.cache.set(key, existing);
        return [...existing];
      }

      this.missCount += 1;
      const vector = this.inner.embed([input])[0];
      this.cache.set(key, vector);
      if (this.cache.size > this.maximumEntries) {
        const oldest = this.cache.keys().next().value as string | undefined;
        if (oldest) this.cache.delete(oldest);
      }
      return [...vector];
    });
  }

  /** Exposes aggregate cache behaviour without exposing user text or vectors. */
  stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hitCount, misses: this.missCount, size: this.cache.size };
  }
}

/** Shared process-local provider; the cache survives adjacent ranking calls. */
export const embeddingProvider = new CachingEmbeddingProvider(
  new LocalEmbeddingProvider(),
);
