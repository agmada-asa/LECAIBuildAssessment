/**
 * @file Unified end-to-end ranking endpoint for canonical conversation logs.
 *
 * Every provider crosses the same validation and normalization boundary before
 * the deterministic ranker calculates signals, confidence, and review policy.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationLogSchema } from "@/lib/conversations/schema";
import { analyseWithCodex, getProviderStatuses } from "@/lib/providers/codex-exec";
import { analyseWithDemo } from "@/lib/providers/demo";
import { normalizeProviderAnalysis } from "@/lib/providers/normalize";
import type { ProviderAnalysis, ProviderId } from "@/lib/providers/types";
import type { RankErrorResponse, RankSuccessResponse } from "@/lib/ranking/api";
import { rankConversation } from "@/lib/ranking/engine";
import { rankingInputSchema } from "@/lib/ranking/schema";
import { DEFAULT_WEIGHTS } from "@/lib/ranking/scenarios";

export const runtime = "nodejs";

const weightsSchema = z.object({
  semantic: z.number().min(0).max(100),
  constraints: z.number().min(0).max(100),
  history: z.number().min(0).max(100),
});

const requestSchema = z.object({
  provider: z.enum(["demo", "codex", "codex-oss"]),
  conversation: conversationLogSchema,
  weights: weightsSchema.optional(),
  previousInput: rankingInputSchema.optional(),
});

/** Serialises the canonical log with source IDs and ordering intact for a CLI provider. */
function formatConversationForProvider(
  conversation: z.infer<typeof conversationLogSchema>,
): string {
  return conversation.messages
    .map(
      (message) =>
        `[${message.id}] (${message.timestamp}): ${message.text}`,
    )
    .join("\n");
}

/** Retries one transient CLI failure; schema/grounding failures are not retried. */
async function analyseLiveProvider(
  provider: Extract<ProviderId, "codex" | "codex-oss">,
  conversation: string,
): Promise<ProviderAnalysis> {
  try {
    return await analyseWithCodex(provider, conversation);
  } catch (error) {
    // Retrying cannot repair output that already failed JSON or schema parsing.
    if (error instanceof SyntaxError || error instanceof z.ZodError) throw error;
    return analyseWithCodex(provider, conversation);
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

  const {
    provider,
    conversation,
    weights = DEFAULT_WEIGHTS,
    previousInput,
  } = parsed.data;
  let analysis: ProviderAnalysis;

  if (provider === "demo") {
    analysis = analyseWithDemo(conversation);
  } else {
    const statuses = await getProviderStatuses();
    const status = statuses.find((item) => item.id === provider);
    if (!status?.available) {
      return errorResponse(503, {
        code: "provider_unavailable",
        message: `${provider === "codex" ? "Codex CLI" : "Codex with Ollama"} is not available. Choose another provider or install its local dependencies.`,
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
    return errorResponse(502, {
      code: "invalid_provider_output",
      message: "The selected provider did not return three grounded, distinct interpretations.",
    });
  }

  const result = rankConversation(
    input,
    conversation.messages,
    weights,
    previousInput,
  );
  const response: RankSuccessResponse = {
    provider: {
      id: provider,
      name:
        provider === "demo"
          ? "Deterministic fallback"
          : provider === "codex"
            ? "Codex CLI"
            : "Codex + Ollama",
      fallback: provider === "demo",
      notes: analysis.notes,
    },
    input,
    result,
  };
  return NextResponse.json(response);
}
