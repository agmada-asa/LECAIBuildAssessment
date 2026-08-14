/**
 * @file Resilient server-configured OpenAI-compatible embedding adapter.
 *
 * Network work happens only in `prepare`; ranking reads validated aggregate
 * vectors synchronously. Requests are bounded, batched, retried only for
 * transient failures, and reported through privacy-safe counters. Long inputs
 * are deterministically chunked and averaged while source offsets are retained.
 */

import { z } from "zod";

import { cacheKey, normalizeEmbeddingInput } from "./lifecycle";
import type {
  EmbeddingChunkProvenance,
  EmbeddingMetrics,
  EmbeddingModel,
  PreparableEmbeddingProvider,
} from "./types";

export type OpenAICompatibleEmbeddingOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Immutable weights/API snapshot. `version` is accepted for old callers. */
  revision?: string;
  version?: string;
  dimensions: number;
  maxInputTokens?: number;
  maxInputCharacters?: number;
  maxBatchSize?: number;
  timeoutMs?: number;
  maximumRetries?: number;
  retryDelayMs?: number;
};

type Chunk = EmbeddingChunkProvenance & { text: string };

const responseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number().finite()),
    }),
  ),
});

/** Splits normalized input at a conservative character bound with exact offsets. */
export function chunkEmbeddingInput(
  input: string,
  maximumCharacters: number,
): Chunk[] {
  const normalized = normalizeEmbeddingInput(input);
  if (!normalized) return [];
  const chunks: Chunk[] = [];
  for (let start = 0; start < normalized.length; start += maximumCharacters) {
    const end = Math.min(normalized.length, start + maximumCharacters);
    chunks.push({
      chunkIndex: chunks.length,
      sourceStart: start,
      sourceEnd: end,
      text: normalized.slice(start, end),
    });
  }
  return chunks;
}

/** Returns a unit-normalized average so chunk count does not inflate similarity. */
function aggregate(vectors: readonly number[][], dimensions: number): number[] {
  if (!vectors.length) return Array<number>(dimensions).fill(0);
  const mean = Array<number>(dimensions).fill(0);
  vectors.forEach((vector) =>
    vector.forEach((value, index) => {
      mean[index] += value / vectors.length;
    }),
  );
  const magnitude = Math.sqrt(mean.reduce((sum, value) => sum + value ** 2, 0));
  return magnitude ? mean.map((value) => value / magnitude) : mean;
}

/** Validated, cached adapter for the conventional `POST /embeddings` shape. */
export class OpenAICompatibleEmbeddingProvider
  implements PreparableEmbeddingProvider
{
  readonly model: EmbeddingModel;
  private readonly cache = new Map<string, number[]>();
  private readonly chunkSources = new Map<string, EmbeddingChunkProvenance[]>();
  private readonly metrics: EmbeddingMetrics = {
    requests: 0,
    retries: 0,
    failures: 0,
    embeddedInputs: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalLatencyMs: 0,
  };

  constructor(private readonly options: OpenAICompatibleEmbeddingOptions) {
    const revision = options.revision ?? options.version;
    if (!revision) {
      throw new Error("An immutable embedding model revision is required.");
    }
    this.model = {
      provider: "openai-compatible",
      name: options.model,
      revision,
      version: revision,
      dimensions: options.dimensions,
      maxInputTokens: options.maxInputTokens ?? 8_192,
      deployment: "hosted",
      purpose: "production",
    };
  }

  /** Fetches uncached text in bounded batches, then caches aggregate vectors. */
  async prepare(texts: readonly string[]): Promise<void> {
    const unique = [...new Set(texts.map(normalizeEmbeddingInput))];
    const missing = unique.filter((text) => {
      const exists = this.cache.has(cacheKey(this.model, text));
      if (exists) this.metrics.cacheHits += 1;
      else this.metrics.cacheMisses += 1;
      return !exists;
    });
    if (!missing.length) return;

    const maximumCharacters = this.options.maxInputCharacters ?? 24_000;
    const work = missing.map((text) => ({
      text,
      chunks: chunkEmbeddingInput(text, maximumCharacters),
    }));
    const chunks = work.flatMap((item) => item.chunks);
    const vectors: number[][] = [];
    const batchSize = Math.max(1, this.options.maxBatchSize ?? 64);
    for (let start = 0; start < chunks.length; start += batchSize) {
      vectors.push(
        ...(await this.requestBatch(
          chunks.slice(start, start + batchSize).map((chunk) => chunk.text),
        )),
      );
    }

    let vectorIndex = 0;
    work.forEach((item) => {
      const itemVectors = vectors.slice(vectorIndex, vectorIndex + item.chunks.length);
      vectorIndex += item.chunks.length;
      const key = cacheKey(this.model, item.text);
      this.cache.set(key, aggregate(itemVectors, this.model.dimensions));
      this.chunkSources.set(
        key,
        item.chunks.map(({ chunkIndex, sourceStart, sourceEnd }) => ({
          chunkIndex,
          sourceStart,
          sourceEnd,
        })),
      );
      this.metrics.embeddedInputs += 1;
    });
  }

  /** Reads prepared vectors; missing values indicate a caller integration bug. */
  embed(texts: readonly string[]): number[][] {
    return texts.map((text) => {
      const vector = this.cache.get(cacheKey(this.model, text));
      if (!vector) {
        throw new Error("Embedding text was not prepared before scoring.");
      }
      return [...vector];
    });
  }

  /** Returns source offsets only, never the potentially sensitive chunk text. */
  provenance(text: string): EmbeddingChunkProvenance[] {
    return (this.chunkSources.get(cacheKey(this.model, text)) ?? []).map((item) => ({
      ...item,
    }));
  }

  /** Returns aggregate operational metrics safe for logs or monitoring. */
  stats(): EmbeddingMetrics {
    return { ...this.metrics };
  }

  /** Calls one batch with timeout and bounded transient-error retries. */
  private async requestBatch(inputs: string[]): Promise<number[][]> {
    const maximumRetries = Math.max(0, this.options.maximumRetries ?? 2);
    for (let attempt = 0; attempt <= maximumRetries; attempt += 1) {
      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.options.timeoutMs ?? 15_000,
      );
      this.metrics.requests += 1;
      try {
        const response = await fetch(
          `${this.options.baseUrl.replace(/\/$/, "")}/embeddings`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.options.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ model: this.options.model, input: inputs }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          const transient = response.status === 429 || response.status >= 500;
          if (transient && attempt < maximumRetries) {
            await this.waitBeforeRetry(attempt);
            continue;
          }
          throw new Error(`The embedding endpoint returned HTTP ${response.status}.`);
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new Error("The embedding endpoint returned an invalid response.");
        }
        const parsed = responseSchema.safeParse(body);
        const ordered = parsed.success
          ? [...parsed.data.data].sort((left, right) => left.index - right.index)
          : [];
        if (
          !parsed.success ||
          ordered.length !== inputs.length ||
          ordered.some((item, index) => item.index !== index)
        ) {
          throw new Error("The embedding endpoint returned an invalid response.");
        }
        ordered.forEach((item) => {
          if (item.embedding.length !== this.model.dimensions) {
            throw new Error(
              `The embedding endpoint returned dimension ${item.embedding.length}; expected ${this.model.dimensions}.`,
            );
          }
        });
        return ordered.map((item) => item.embedding);
      } catch (error) {
        const canRetryNetworkFailure =
          !(error instanceof Error) ||
          error.name === "AbortError" ||
          error instanceof TypeError;
        if (canRetryNetworkFailure && attempt < maximumRetries) {
          await this.waitBeforeRetry(attempt);
          continue;
        }
        this.metrics.failures += 1;
        if (error instanceof Error && error.message.startsWith("The embedding")) {
          throw error;
        }
        throw new Error("The embedding endpoint could not be reached.");
      } finally {
        clearTimeout(timeout);
        this.metrics.totalLatencyMs += Date.now() - started;
      }
    }
    throw new Error("The embedding endpoint could not be reached.");
  }

  /** Applies bounded exponential backoff without inspecting response bodies. */
  private async waitBeforeRetry(attempt: number): Promise<void> {
    this.metrics.retries += 1;
    const delay = (this.options.retryDelayMs ?? 100) * 2 ** attempt;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
