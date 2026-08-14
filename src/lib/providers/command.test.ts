/** @file Safety contract tests for non-interactive Codex command arguments. */

import { describe, expect, it } from "vitest";

import { buildCodexArguments } from "./command";

describe("buildCodexArguments", () => {
  it("isolates extraction from user configuration and write access", () => {
    const argumentsList = buildCodexArguments(
      "codex",
      "/tmp/analysis.schema.json",
    );

    expect(argumentsList).toEqual(
      expect.arrayContaining([
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
      ]),
    );
    expect(argumentsList.at(-1)).toBe("-");
  });

  it("selects Ollama explicitly for local open-weight inference", () => {
    expect(
      buildCodexArguments("codex-oss", "/tmp/analysis.schema.json"),
    ).toEqual(expect.arrayContaining(["--oss", "--local-provider", "ollama"]));
  });
});
