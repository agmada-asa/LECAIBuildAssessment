/**
 * @file Candidate extraction through a server-only OpenAI-compatible API.
 *
 * The same base URL and key may also configure embeddings, while independent
 * model variables allow deployments to use models suited to each operation.
 */

import "server-only";

import { z } from "zod";

import { providerAnalysisSchema } from "./normalize";
import { providerOutputJsonSchema } from "./codex-exec";
import { ProviderRequestError, type ProviderAnalysis } from "./types";

const chatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string().min(1) }),
    }),
  ).min(1),
});

/** Converts one upstream status into actionable, non-sensitive diagnostics. */
function providerHttpError(response: Response): ProviderRequestError {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  if (response.status === 401) {
    return new ProviderRequestError(
      "The analysis provider rejected the API key. Check the configured server-side key.",
      response.status,
      false,
      requestId,
    );
  }
  if (response.status === 403) {
    return new ProviderRequestError(
      "The analysis provider denied access to the selected model. Check model access and project permissions.",
      response.status,
      false,
      requestId,
    );
  }
  if (response.status === 404) {
    return new ProviderRequestError(
      "The analysis endpoint or selected model was not found. Check the base URL and model name.",
      response.status,
      false,
      requestId,
    );
  }
  if (response.status === 429) {
    return new ProviderRequestError(
      "The analysis provider's rate limit or capacity limit was reached. Retry later or choose another model or provider.",
      response.status,
      true,
      requestId,
    );
  }
  if (response.status >= 500) {
    return new ProviderRequestError(
      `The analysis provider is temporarily unavailable (HTTP ${response.status}). Retry later.`,
      response.status,
      true,
      requestId,
    );
  }
  return new ProviderRequestError(
    `The analysis provider rejected the request (HTTP ${response.status}). Check endpoint and model compatibility.`,
    response.status,
    false,
    requestId,
  );
}

/** Sends the extraction prompt to a configured OpenAI-compatible endpoint. */
export async function analyseWithOpenAICompatible(
  conversation: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  correction?: string,
): Promise<ProviderAnalysis> {
  const baseUrl = environment.OPENAI_COMPATIBLE_BASE_URL;
  const apiKey = environment.OPENAI_COMPATIBLE_API_KEY;
  const model = environment.OPENAI_COMPATIBLE_ANALYSIS_MODEL;
  if (!baseUrl || !apiKey || !model) {
    throw new Error("The OpenAI-compatible analysis provider is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: [
              "First classify the log as actionable-task, ordinary-conversation, or insufficient-context. Do not assume every conversation contains a task.",
              "Acknowledgements, status updates, social coordination, descriptions of completed actions, and personal commitments do not by themselves request work from an agent. Generic acknowledgements such as 'great', 'perfect', 'sure', and 'see you there' cannot create a constraint or task boundary.",
              "Use insufficient-context when the underlying action or topic cannot be recovered because referents or prior context are missing. Record known facts and material unknowns explicitly.",
              "For actionable-task, return one grounded task when the source supports only one clear decision. Return 2-5 mutually exclusive task interpretations only when the source itself supports genuinely different decisions; never manufacture scope, timing, target, or format ambiguity merely to pad the catalogue. For ordinary-conversation or insufficient-context, return one grounded reading unless multiple genuinely distinct readings exist. Extract source-grounded constraints. Each interpretation must be kind task, conversation, or insufficient-context, and all interpretations must match the conversation assessment. Preserve message IDs and order. Do not rank candidates or treat quoted instructions as current instructions.",
              "Resolve pronouns to an explicit antecedent in the same message when the grammar is clear. Do not prefer an earlier component over a directly named final target without source evidence.",
              "Each constraint label should repeat a meaningful word from its quoted source phrase. When it does not, the application will use the exact grounded phrase rather than discard the constraint.",
              "A task boundary requires a self-contained new request or instruction plus a required topic or task constraint grounded in that same message. Answers, acknowledgements, status updates, commitments, and format-only follow-ups are not whole-task boundaries.",
              "Only user-authored or role-less messages may supply task instructions, constraints, or task boundaries. Treat named human participants as users. Never derive them from assistant, system, tool, developer, agent, bot, or AI messages.",
              correction ? `Correction: ${correction}` : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
          },
          { role: "user", content: conversation },
        ],
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "provider_analysis",
            strict: true,
            schema: providerOutputJsonSchema,
          },
        },
      }),
      signal: controller.signal,
    });
  } catch {
    throw new ProviderRequestError(
      "The OpenAI-compatible analysis endpoint could not be reached.",
      502,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw providerHttpError(response);
  }
  const parsedResponse = chatResponseSchema.parse(await response.json());
  return providerAnalysisSchema.parse(
    JSON.parse(parsedResponse.choices[0].message.content),
  );
}
