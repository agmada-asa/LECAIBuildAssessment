/** @file Provider-output normalization and ranker-boundary regression tests. */

import { describe, expect, it } from "vitest";

import { normalizeProviderAnalysis } from "./normalize";
import type { ConversationLog } from "@/lib/conversations/schema";

const log: ConversationLog = {
  conversationId: "c1",
  userId: "u1",
  messages: [
    {
      id: "M1",
      text: "Perhaps produce slides.",
      timestamp: "2026-08-14T08:00:00.000Z",
    },
    {
      id: "M2",
      text: "Send raw rows as CSV.",
      timestamp: "2026-08-14T08:01:00.000Z",
    },
  ],
  acceptedOutcomes: [],
};

const validAnalysis = {
  interpretations: [
    {
      id: "candidate one",
      title: "CSV export",
      summary: "Export the raw rows as CSV.",
      semanticTerms: ["CSV", "raw rows", "export"],
      features: ["format:csv"],
    },
    {
      id: "candidate-two",
      title: "Slide deck",
      summary: "Prepare a presentation.",
      semanticTerms: ["slides", "deck", "presentation"],
      features: ["format:slides"],
    },
    {
      id: "candidate-three",
      title: "Dashboard",
      summary: "Publish an interactive dashboard.",
      semanticTerms: ["dashboard", "interactive", "publish"],
      features: ["format:dashboard"],
    },
  ],
  constraints: [
    {
      id: "csv-required",
      phrases: ["as CSV"],
      dimension: "format",
      value: "csv",
      mode: "require" as const,
      strength: 1,
      label: "Use CSV",
    },
  ],
  notes: "Three alternatives.",
};

describe("normalizeProviderAnalysis", () => {
  it("creates stable keys and grounds constraints in source messages", () => {
    const result = normalizeProviderAnalysis(validAnalysis, log);

    expect(result.interpretations[0].id).toBe("csv-export");
    expect(result.constraintRules[0].phrases).toEqual(["as CSV"]);
  });

  it("rejects malformed feature tags", () => {
    expect(() =>
      normalizeProviderAnalysis(
        {
          ...validAnalysis,
          interpretations: validAnalysis.interpretations.map((item, index) =>
            index === 0 ? { ...item, features: ["csv"] } : item,
          ),
        },
        log,
      ),
    ).toThrow(/dimension:value/);

  });

  it("grounds constraints without requiring participant roles", () => {
    const result = normalizeProviderAnalysis(
      {
        ...validAnalysis,
        constraints: [
          { ...validAnalysis.constraints[0], phrases: ["produce slides"] },
        ],
      },
      log,
    );

    expect(result.constraintRules[0].phrases).toEqual(["produce slides"]);
  });

  it("requires at least three genuinely distinct candidates", () => {
    const duplicate = {
      ...validAnalysis,
      interpretations: [
        validAnalysis.interpretations[0],
        { ...validAnalysis.interpretations[0], id: "duplicate" },
        validAnalysis.interpretations[1],
      ],
    };

    expect(() => normalizeProviderAnalysis(duplicate, log)).toThrow(
      /three genuinely distinct interpretations/,
    );
  });

  it("rejects contradictory constraint claims from one provider response", () => {
    expect(() =>
      normalizeProviderAnalysis(
        {
          ...validAnalysis,
          constraints: [
            validAnalysis.constraints[0],
            { ...validAnalysis.constraints[0], id: "csv-forbidden", mode: "forbid" },
          ],
        },
        log,
      ),
    ).toThrow(/contradictory constraints/);
  });
});
