/** @file Contract tests for the structured live-provider output schema. */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { providerOutputJsonSchema } from "./codex-exec";

describe("providerOutputJsonSchema", () => {
  it("constrains canonical features and constraint keys before Zod validation", () => {
    const interpretation = providerOutputJsonSchema.properties.interpretations.items;
    const constraint = providerOutputJsonSchema.properties.constraints.items;

    expect(interpretation.properties.features.items).toMatchObject({
      type: "string",
      pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*$",
    });
    expect(constraint.properties.dimension).toMatchObject({
      type: "string",
      pattern: "^[a-z][a-z0-9-]*$",
    });
    expect(constraint.properties.value).toMatchObject({
      type: "string",
      pattern: "^[a-z0-9][a-z0-9-]*$",
    });
  });
});
