/** @file Safety contract tests for non-interactive Codex command arguments. */

import { describe, expect, it } from "vitest";

import { buildCodexArguments } from "./command";

describe("buildCodexArguments", () => {
  it("isolates extraction from user configuration and write access", () => {
    const argumentsList = buildCodexArguments("/tmp/analysis.schema.json");

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

  it("does not enable an implicit local-model backend", () => {
    expect(buildCodexArguments("/tmp/analysis.schema.json")).not.toEqual(
      expect.arrayContaining(["--oss", "--local-provider"]),
    );
  });
});
