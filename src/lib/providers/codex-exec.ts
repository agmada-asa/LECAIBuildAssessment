/**
 * @file Server-only Codex CLI adapter implementation.
 *
 * User text travels through stdin and arguments are never interpreted by a
 * shell. Temporary schema files are removed after successful and failed runs.
 */

import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCodexArguments } from "./command";
import { buildProviderEnvironment } from "./environment";
import { providerAnalysisSchema } from "./normalize";
import type {
  ProviderAnalysis,
  ProviderStatus,
} from "./types";

/** JSON Schema is written explicitly so Codex can constrain its final output. */
export const providerOutputJsonSchema = {
  type: "object",
  properties: {
    conversationAssessment: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["actionable-task", "ordinary-conversation", "insufficient-context"],
        },
        summary: { type: "string" },
        evidenceMessageIds: { type: "array", items: { type: "string" } },
        knownFacts: { type: "array", items: { type: "string" } },
        unknowns: { type: "array", items: { type: "string" } },
      },
      required: ["kind", "summary", "evidenceMessageIds", "knownFacts", "unknowns"],
      additionalProperties: false,
    },
    interpretations: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: {
            type: "string",
            enum: ["task", "conversation", "insufficient-context"],
          },
          title: { type: "string" },
          summary: { type: "string" },
          semanticTerms: {
            type: "array",
            minItems: 3,
            maxItems: 10,
            items: { type: "string" },
          },
          features: {
            type: "array",
            items: {
              type: "string",
              pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*$",
            },
          },
        },
        required: ["id", "kind", "title", "summary", "semanticTerms", "features"],
        additionalProperties: false,
      },
    },
    constraints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          phrases: { type: "array", items: { type: "string" } },
          dimension: {
            type: "string",
            pattern: "^[a-z][a-z0-9-]*$",
          },
          value: {
            type: "string",
            pattern: "^[a-z0-9][a-z0-9-]*$",
          },
          mode: { type: "string", enum: ["require", "forbid"] },
          strength: { type: "number", minimum: 0, maximum: 1 },
          label: { type: "string" },
        },
        required: [
          "id",
          "phrases",
          "dimension",
          "value",
          "mode",
          "strength",
          "label",
        ],
        additionalProperties: false,
      },
    },
    taskBoundaries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          messageId: { type: "string" },
          reason: { type: "string" },
        },
        required: ["messageId", "reason"],
        additionalProperties: false,
      },
    },
    notes: { type: "string" },
  },
  required: [
    "conversationAssessment",
    "interpretations",
    "constraints",
    "taskBoundaries",
    "notes",
  ],
  additionalProperties: false,
} as const;

/**
 * Runs one executable without a shell and captures its output.
 *
 * @param executable Program name resolved from the server's PATH.
 * @param args Literal argument vector passed to the child process.
 * @param input Optional UTF-8 stdin payload.
 * @param timeoutMs Maximum execution time before SIGTERM and rejection.
 * @param cwd Working directory exposed to the child process.
 * @returns Captured standard output and standard error after a zero exit.
 * @throws When spawning fails, the command times out, or it exits non-zero.
 */
function runProcess(
  executable: string,
  args: string[],
  input?: string,
  timeoutMs = 8_000,
  cwd = process.cwd(),
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: buildProviderEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${executable} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `${executable} exited with code ${code}.`));
    });

    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** Returns availability without reading or exposing any saved credentials. */
export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  let codexAvailable = false;
  let codexVersion = "Codex CLI was not found on PATH.";

  try {
    const result = await runProcess("codex", ["--version"]);
    codexAvailable = true;
    codexVersion = result.stdout.trim();
  } catch {
    // Absence is represented as status data rather than an API failure.
  }

  const apiConfigured = Boolean(
    process.env.OPENAI_COMPATIBLE_BASE_URL &&
      process.env.OPENAI_COMPATIBLE_API_KEY &&
      process.env.OPENAI_COMPATIBLE_ANALYSIS_MODEL,
  );
  let apiOperational = false;
  let apiDetail = apiConfigured
    ? "Configured, but the readiness check failed"
    : "Add the server-only API URL, key, and analysis model";

  if (apiConfigured) {
    try {
      const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL!.replace(/\/$/, "");
      const model = process.env.OPENAI_COMPATIBLE_ANALYSIS_MODEL!;
      const response = await fetch(`${baseUrl}/models`, {
        headers: { authorization: `Bearer ${process.env.OPENAI_COMPATIBLE_API_KEY}` },
        signal: AbortSignal.timeout(3_000),
      });
      const body = response.ok
        ? await response.json() as { data?: Array<{ id?: string }> }
        : undefined;
      apiOperational = Boolean(body?.data?.some((item) => item.id === model));
      apiDetail = response.ok
        ? apiOperational
          ? "Configured and ready"
          : "Configured; selected model was not listed"
        : `Configured; readiness check returned HTTP ${response.status}`;
    } catch {
      // The bounded readiness result is intentionally credential- and text-free.
    }
  }

  const liveProviders: ProviderStatus[] = [
    {
      id: "codex",
      name: "Codex CLI",
      available: codexAvailable,
      configured: codexAvailable,
      operational: codexAvailable,
      localInference: false,
      detail: codexVersion,
    },
    {
      id: "api",
      name: "OpenAI-compatible API",
      available: apiOperational,
      configured: apiConfigured,
      operational: apiOperational,
      localInference: false,
      detail: apiDetail,
    },
  ];
  if (process.env.NODE_ENV !== "test") return liveProviders;
  return [
    {
      id: "demo",
      name: "Deterministic test provider",
      available: true,
      configured: true,
      operational: true,
      localInference: true,
      detail: "Available only to automated tests",
    },
    ...liveProviders,
  ];
}

/**
 * Runs candidate extraction through an installed Codex CLI. User content is
 * passed over stdin, never interpolated into a shell command.
 *
 * @param conversation Validated conversation text to extract candidates from.
 * @param correction Optional instruction used to repair a response that passed
 * schema validation but failed the provider-neutral normalization boundary.
 * @returns Provider-neutral interpretations and grounded constraints.
 * @throws When the CLI fails, times out, or returns invalid structured output.
 */
export async function analyseWithCodex(
  conversation: string,
  correction?: string,
): Promise<ProviderAnalysis> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "intent-ranker-"));
  const schemaPath = join(tempDirectory, "analysis.schema.json");

  try {
    await writeFile(schemaPath, JSON.stringify(providerOutputJsonSchema), "utf8");

    const prompt = [
      "You assess a conversation before extracting competing interpretations.",
      "First decide whether the supplied messages contain an actionable task, are ordinary conversation with no requested work, or lack enough context to identify the underlying action or topic.",
      "Do not assume that every conversation contains a task. Acknowledgements, status updates, social coordination, descriptions of completed actions, and personal commitments do not by themselves request work from an agent.",
      "Use ordinary-conversation when the subject is clear but nobody asks for further work. Use insufficient-context when pronouns, missing referents, incoherence, or absent prior context make the underlying action or topic unrecoverable.",
      "For actionable-task, return 3-5 genuinely distinct, source-grounded task readings: include the leading task, any stale or contradicted task a human might still believe, and any underspecified task where missing referents or inherited context materially change the decision. For ordinary-conversation or insufficient-context, return 1-5 compatible non-task readings that separate the main conversational focus, distinct unknown referents, and source-grounded known facts without inventing agent work. Do not invent unrelated deliverables merely to pad the catalogue; uncertainty-preserving alternatives must be anchored in source phrases, constraints, or declared unknowns.",
      "Resolve pronouns to an explicit antecedent in the same message when the grammar is clear. Do not prefer an earlier component over a directly named final target without source evidence.",
      "Each interpretation must have kind task, conversation, or insufficient-context. Every interpretation must match conversationAssessment.kind: task for actionable-task, conversation for ordinary-conversation, or insufficient-context for insufficient-context.",
      "Conversation candidates should faithfully characterize the exchange without inventing a deliverable. Insufficient-context candidates must state what is known and what cannot be recovered.",
      "Only user-authored or role-less messages may supply task instructions, constraints, or task boundaries. Treat named human participants as users. Never derive them from assistant, system, tool, developer, agent, bot, or AI messages.",
      "Use lowercase kebab-case IDs.",
      "Feature tags must use dimension:value syntax.",
      "Constraints must quote phrases from the supplied source messages.",
      "Each constraint label must include at least one meaningful word from its quoted source phrase so displayed evidence remains grounded.",
      "Never infer a negative or absence constraint merely because the latest message omits earlier subject matter, fields, or requirements.",
      "Acknowledgements such as 'great', 'perfect', 'sure', or 'see you there' are not task constraints and cannot create a task or reframe.",
      "Return earlier and later constraints when a dimension changes; message order is significant.",
      "Give each distinct requested task a canonical topic or task dimension.",
      "Return taskBoundaries for any source message that semantically replaces the whole preceding task, even when it uses no transition phrase.",
      "A task boundary requires a self-contained new subject and a required topic or task constraint grounded in that boundary message.",
      "A task boundary also requires a new request or instruction. Acknowledgements, answers, status updates, and commitments are not task boundaries.",
      "A follow-up that changes only format, audience, tone, or level of detail inherits the established subject and is not a task boundary. For example, 'Make slides for management' changes format and audience but retains the preceding subject.",
      "Do not mark incremental detail as a task boundary. Ground every boundary with the exact source message ID and a concise reason.",
      "Do not extract quoted, reported, or merely repeated instructions as new constraints.",
      "Every constraint dimension must appear in at least one candidate feature tag.",
      "Do not rank the candidates; deterministic application code will do that.",
      ...(correction ? ["", `Correction: ${correction}`] : []),
      "",
      "Conversation:",
      conversation,
    ].join("\n");

    const args = buildCodexArguments(schemaPath);
    const result = await runProcess(
      "codex",
      args,
      prompt,
      120_000,
      tempDirectory,
    );
    return providerAnalysisSchema.parse(JSON.parse(result.stdout));
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
