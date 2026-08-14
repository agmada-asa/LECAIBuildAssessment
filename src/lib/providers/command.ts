/** @file Safe argument construction for structured Codex CLI extraction. */

/**
 * Builds a non-interactive command that cannot write or load configured tools.
 *
 * @param schemaPath Absolute path to the temporary output schema.
 * @returns Literal arguments for `spawn`; the final dash reads the prompt from stdin.
 */
export function buildCodexArguments(schemaPath: string): string[] {
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

  argumentsList.push("-");
  return argumentsList;
}
