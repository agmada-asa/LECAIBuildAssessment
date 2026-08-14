/** @file Safe argument construction for structured Codex CLI extraction. */

import type { ProviderId } from "./types";

/**
 * Builds a non-interactive command that cannot write or load configured tools.
 *
 * @param provider Hosted Codex or the explicit Ollama-backed provider.
 * @param schemaPath Absolute path to the temporary output schema.
 * @returns Literal arguments for `spawn`; the final dash reads the prompt from stdin.
 */
export function buildCodexArguments(
  provider: Extract<ProviderId, "codex" | "codex-oss">,
  schemaPath: string,
): string[] {
  const argumentsList = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--output-schema",
    schemaPath,
  ];

  if (provider === "codex-oss") {
    argumentsList.push("--oss", "--local-provider", "ollama");
  }

  argumentsList.push("-");
  return argumentsList;
}
