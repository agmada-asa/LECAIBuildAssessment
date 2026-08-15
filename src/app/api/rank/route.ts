/**
 * @file Unified end-to-end ranking endpoint for canonical conversation logs.
 *
 * Every provider crosses the same validation and normalization boundary before
 * the deterministic ranker calculates signals, confidence, and review policy.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationLogSchema } from "@/lib/conversations/schema";
import { createConfiguredEmbeddingProvider } from "@/lib/embeddings/config";
import { consolidateSemanticDuplicates } from "@/lib/embeddings/deduplicate";
import type { PreparableEmbeddingProvider } from "@/lib/embeddings/types";
import { deviceIdFromRequest } from "@/lib/persistence/device";
import { createSQLiteRepository } from "@/lib/persistence/sqlite";
import { rankingRunIdempotencyKey } from "@/lib/persistence/queue-reconciliation";
import { analyseWithCodex, getProviderStatuses } from "@/lib/providers/codex-exec";
import { analyseWithDemo } from "@/lib/providers/demo";
import { normalizeProviderAnalysis } from "@/lib/providers/normalize";
import { analyseWithOpenAICompatible } from "@/lib/providers/openai-compatible";
import {
  ProviderRequestError,
  type ProviderAnalysis,
  type ProviderId,
} from "@/lib/providers/types";
import type { RankErrorResponse, RankSuccessResponse } from "@/lib/ranking/api";
import { selectActiveTaskMessages } from "@/lib/ranking/constraints";
import { rankConversationAsync } from "@/lib/ranking/engine";
import { DEFAULT_WEIGHTS } from "@/lib/ranking/policy";
import { normaliseWeights } from "@/lib/ranking/scoring";
import type { RankingInput } from "@/lib/ranking/types";

export const runtime = "nodejs";

const weightsSchema = z.object({
  semantic: z.number().min(0).max(100),
  constraints: z.number().min(0).max(100),
  history: z.number().min(0).max(100),
});

const providerSchema = z.enum(["demo", "codex", "api"]).refine(
  (provider) =>
    process.env.NODE_ENV === "test" ||
    process.env.RESOLVE_ENABLE_TEST_PROVIDER === "1" ||
    provider !== "demo",
  "The deterministic provider is available only to automated tests.",
);

const requestSchema = z.object({
  provider: providerSchema,
  conversation: conversationLogSchema,
  weights: weightsSchema.optional(),
  queuedTask: z.object({
    id: z.string().trim().min(1).max(200),
    revision: z.number().int().positive(),
  }).optional(),
});

/** Serialises source IDs, participant roles, and ordering for live providers. */
function formatConversationForProvider(
  conversation: z.infer<typeof conversationLogSchema>,
): string {
  return conversation.messages
    .map(
      (message) =>
        `[${message.id}] (author=${message.author ?? "unspecified"}; timestamp=${message.timestamp}): ${message.text}`,
    )
    .join("\n");
}

/** Retries one transient execution failure using the same provider request. */
async function analyseLiveProvider(
  provider: Extract<ProviderId, "codex" | "api">,
  conversation: string,
  correction?: string,
): Promise<ProviderAnalysis> {
  const analyse = () =>
    provider === "codex"
      ? analyseWithCodex(conversation, correction)
      : analyseWithOpenAICompatible(conversation, process.env, correction);
  try {
    return await analyse();
  } catch (error) {
    // Retrying cannot repair output that already failed JSON or schema parsing.
    if (error instanceof SyntaxError || error instanceof z.ZodError) throw error;
    if (error instanceof ProviderRequestError && !error.retryable) throw error;
    return analyse();
  }
}

/** Builds a consistent structured error response without reflecting diagnostics. */
function errorResponse(
  status: number,
  error: RankErrorResponse["error"],
): NextResponse<RankErrorResponse> {
  return NextResponse.json({ error }, { status });
}

/** Validates, extracts candidates, ranks them, and returns grounded evidence. */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return errorResponse(400, {
      code: "invalid_json",
      message: "Send a valid JSON request body.",
    });
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      code: "invalid_conversation",
      message: "The conversation could not be analysed. Correct the listed fields.",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  let {
    provider,
    conversation,
    weights = DEFAULT_WEIGHTS,
  } = parsed.data;
  const { queuedTask } = parsed.data;
  const repository = createSQLiteRepository();
  const deviceId = deviceIdFromRequest(request);
  const canPersist = Boolean(deviceId);
  let previousInput: RankingInput | undefined;

  if (queuedTask) {
    if (!deviceId) {
      return errorResponse(409, {
        code: "invalid_queue_revision",
        message: "The queued ranking revision is unavailable to this browser.",
      });
    }
    const queued = await repository.rankingTaskForOwner(deviceId, queuedTask);
    if (!queued) {
      return errorResponse(409, {
        code: "invalid_queue_revision",
        message: "The queued ranking revision is missing, stale, or belongs to another browser.",
      });
    }
    // A queue reference is an authority-bearing server snapshot. Ignore mutable
    // request fields so comparisons and persistence use the exact same revision.
    provider = queued.request.provider;
    conversation = queued.request.conversation;
    weights = queued.request.weights ?? DEFAULT_WEIGHTS;
    previousInput = queued.request.previousInput;
  }
  let analysis: ProviderAnalysis;

  if (provider === "demo") {
    try {
      analysis = analyseWithDemo(conversation);
    } catch {
      return errorResponse(422, {
        code: "candidate_generation_unavailable",
        message:
          "The deterministic provider needs three distinct tasks grounded in user messages. Choose a live provider for sparse or ambiguous logs.",
      });
    }
  } else {
    const statuses = await getProviderStatuses();
    const status = statuses.find((item) => item.id === provider);
    if (!status?.available) {
      return errorResponse(503, {
        code: "provider_unavailable",
        message:
          provider === "codex"
            ? "Codex CLI is not available. Choose another provider or install it locally."
            : "The OpenAI-compatible API is not configured. Add its server-only URL, key, and analysis model.",
      });
    }

    try {
      analysis = await analyseLiveProvider(
        provider,
        formatConversationForProvider(conversation),
      );
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        return errorResponse(502, {
          code: "invalid_provider_output",
          message: "The selected provider returned malformed structured output.",
        });
      }
      if (error instanceof ProviderRequestError) {
        return errorResponse(error.status === 429 ? 429 : 502, {
          code: error.status === 429 ? "provider_rate_limited" : "provider_failure",
          message: error.message,
        });
      }
      return errorResponse(502, {
        code: "provider_failure",
        message: "The selected provider failed after one safe retry. No diagnostic details were exposed.",
      });
    }
  }

  let input;
  try {
    input = normalizeProviderAnalysis(analysis, conversation);
  } catch {
    if (provider !== "demo") {
      try {
        analysis = await analyseLiveProvider(
          provider,
          formatConversationForProvider(conversation),
          "The previous response passed the JSON schema but failed normalization. For actionable-task return at least three genuinely distinct task interpretations; for ordinary-conversation or insufficient-context return at least one grounded matching interpretation. Keep every candidate kind consistent with the conversation assessment, ground assessment message IDs and every constraint phrase in the source text, repeat a meaningful source word in each constraint label, and ensure every constraint dimension appears in candidate features.",
        );
        input = normalizeProviderAnalysis(analysis, conversation);
      } catch {
        return errorResponse(502, {
          code: "invalid_provider_output",
          message: "The selected provider did not return a grounded candidate catalogue after one corrective retry.",
        });
      }
    } else {
      return errorResponse(502, {
        code: "invalid_provider_output",
        message: "The selected provider did not return a grounded candidate catalogue.",
      });
    }
  }

  const persistence: RankSuccessResponse["persistence"] = {
    enabled: true,
    identified: canPersist,
  };
  let result;
  let embeddings;
  try {
    embeddings = createConfiguredEmbeddingProvider();
    let consolidated = await consolidateSemanticDuplicates(
      input.interpretations,
      embeddings,
    );
    const requiresCompetingTasks =
      input.conversationAssessment?.kind === "actionable-task" ||
      !input.conversationAssessment ||
      input.conversationAssessment.kind === "undetermined";
    if (
      requiresCompetingTasks &&
      consolidated.candidates.length < 3 &&
      provider !== "demo"
    ) {
      analysis = await analyseLiveProvider(
        provider,
        formatConversationForProvider(conversation),
        "The previous catalogue contained semantic paraphrases. Return at least three mutually exclusive decisions with conflicting canonical features where appropriate, preserve a candidate kind matching the conversation assessment, and do not pad the catalogue with differently worded versions of one deliverable.",
      );
      input = normalizeProviderAnalysis(analysis, conversation);
      consolidated = await consolidateSemanticDuplicates(
        input.interpretations,
        embeddings,
      );
    }
    if (consolidated.candidates.length < (requiresCompetingTasks ? 3 : 1)) {
      return errorResponse(provider === "demo" ? 422 : 502, {
        code:
          provider === "demo"
            ? "candidate_generation_unavailable"
            : "invalid_provider_output",
        message:
          requiresCompetingTasks
            ? "Candidate generation did not produce three genuinely distinct decisions after semantic consolidation."
            : "Candidate generation did not produce a grounded reading after semantic consolidation.",
      });
    }
    input = { ...input, interpretations: consolidated.candidates };
    if (canPersist && deviceId) {
      // Retrieval and scoring must describe the same current task. Exclude
      // assistant content and every user task superseded by the latest boundary.
      const historyText = selectActiveTaskMessages(
        conversation.messages,
        input.taskBoundaries,
      ).map((message) => message.text).join(" ");
      const preparable = embeddings as Partial<PreparableEmbeddingProvider>;
      if (preparable.prepare) await preparable.prepare([historyText]);
      const [historyEmbedding] = embeddings.embed([historyText]);
      const matches = await repository.findSimilarOutcomes({
        ownerId: deviceId,
        userId: conversation.userId,
        domainName: conversation.domain?.name,
        embedding: historyEmbedding,
        embeddingModel: embeddings.model.name,
        embeddingVersion: embeddings.model.version,
        limit: 5,
      });
      input.history = [
        ...input.history,
        ...matches.map((match) => ({
          id: match.id,
          interpretationId: match.interpretationKey,
          summary: `${match.title}. ${match.summary}`,
          terms: match.semanticTerms,
          accepted: match.accepted,
          similarity: match.similarity,
          userId: match.userId,
          domainName: match.domainName,
          decision: match.decision,
        })),
      ];
    }
    result = await rankConversationAsync(
      input,
      conversation.messages,
      weights,
      previousInput,
      embeddings,
    );
  } catch {
    return errorResponse(502, {
      code: "embedding_failure",
      message: "Semantic embeddings could not be generated with the configured model.",
    });
  }
  if (canPersist && deviceId) {
    try {
      const interpretationEmbeddings = Object.fromEntries(
        input.interpretations.map((interpretation) => {
          const text = [
            interpretation.title,
            interpretation.summary,
            ...interpretation.semanticTerms,
          ].join(". ");
          return [interpretation.id, embeddings.embed([text])[0]];
        }),
      );
      const idempotencyKey = rankingRunIdempotencyKey({
        provider,
        conversation,
        weights,
      });
      const stored = await repository.persistRankingRun({
        ownerId: deviceId,
        idempotencyKey,
        provider,
        weights: normaliseWeights(weights),
        conversation,
        input,
        result,
        interpretationEmbeddings,
      });
      Object.assign(persistence, {
        state: stored.state,
        rankingRunId: stored.id,
        duplicate: stored.duplicate,
      });
    } catch {
      Object.assign(persistence, {
        state: "failed" as const,
        message: "The ranking completed, but its state could not be persisted.",
      });
    }
  } else {
    persistence.message = "Ranking completed, but this browser did not provide a device identifier.";
  }
  const response: RankSuccessResponse = {
    provider: {
      id: provider,
      name:
        provider === "demo"
          ? "Deterministic fallback"
          : provider === "codex"
            ? "Codex CLI"
            : "OpenAI-compatible API",
      fallback: provider === "demo",
      notes: analysis.notes,
    },
    input,
    result,
    persistence,
  };
  if (canPersist && deviceId && queuedTask) {
    try {
      await repository.completePendingRankingTask(deviceId, queuedTask, response);
    } catch {
      persistence.message = persistence.message
        ? `${persistence.message} The task queue status could not be updated.`
        : "The ranking completed, but the task queue status could not be updated.";
    }
  }
  return NextResponse.json(response);
}
