/** @file Server-only configuration for API-backed embedding models. */

import { OpenAICompatibleEmbeddingProvider } from "./openai-compatible";
import { embeddingProvider } from "./provider";
import type { EmbeddingProvider } from "./types";

/**
 * Builds the configured OpenAI-compatible provider without exposing credentials.
 * The application deliberately has no local runtime or implicit fallback.
 */
export function createConfiguredEmbeddingProvider(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): EmbeddingProvider {
  const selection =
    environment.EMBEDDING_PROVIDER ??
    (environment.NODE_ENV === "test" ? "demo-feature-hash" : "openai-compatible");
  if (environment.NODE_ENV === "test" && selection === "demo-feature-hash") {
    return embeddingProvider;
  }
  if (selection !== "openai-compatible") {
    throw new Error(
      `Only openai-compatible API embeddings are supported; received ${selection}.`,
    );
  }
  const baseUrl = environment.OPENAI_COMPATIBLE_BASE_URL;
  const apiKey = environment.OPENAI_COMPATIBLE_API_KEY;
  const model = environment.OPENAI_COMPATIBLE_EMBEDDING_MODEL;
  const revision = environment.OPENAI_COMPATIBLE_EMBEDDING_REVISION;
  const dimensions = Number(environment.OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS);
  const maxInputTokens = Number(
    environment.OPENAI_COMPATIBLE_EMBEDDING_MAX_INPUT_TOKENS,
  );
  if (
    !baseUrl ||
    !apiKey ||
    !model ||
    !revision ||
    !Number.isInteger(dimensions) ||
    dimensions < 1 ||
    !Number.isInteger(maxInputTokens) ||
    maxInputTokens < 1
  ) {
    throw new Error("OpenAI-compatible embedding configuration is incomplete.");
  }
  return new OpenAICompatibleEmbeddingProvider({
    baseUrl,
    apiKey,
    model,
    revision,
    dimensions,
    maxInputTokens,
    maxBatchSize: Number(environment.OPENAI_COMPATIBLE_EMBEDDING_MAX_BATCH_SIZE) || 64,
    maxInputCharacters:
      Number(environment.OPENAI_COMPATIBLE_EMBEDDING_MAX_INPUT_CHARACTERS) ||
      maxInputTokens * 3,
    timeoutMs: Number(environment.EMBEDDING_TIMEOUT_MS) || 15_000,
    maximumRetries: Number(environment.EMBEDDING_MAX_RETRIES) || 2,
  });
}
