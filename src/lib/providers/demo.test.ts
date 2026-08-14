/** @file Regression tests for the credential-free grounded provider. */

import { describe, expect, it } from "vitest";

import type { ConversationLog } from "@/lib/conversations/schema";
import { analyseWithDemo } from "./demo";
import { normalizeProviderAnalysis } from "./normalize";
import { rankConversation } from "@/lib/ranking/engine";

function conversation(texts: string[]): ConversationLog {
  return {
    conversationId: "open-set-regression",
    userId: "reviewer",
    messages: texts.map((text, index) => ({
      id: `M${index + 1}`,
      text,
      timestamp: `2026-08-14T09:0${index}:00.000Z`,
    })),
    acceptedOutcomes: [],
  };
}

describe("analyseWithDemo", () => {
  it("builds candidates from the imported tasks instead of a fixed format catalogue", () => {
    const log = conversation([
      "Book a dentist appointment for next Tuesday.",
      "Compare flights from London to Lisbon.",
      "Write the customer an apology email for the delay.",
    ]);

    const analysis = analyseWithDemo(log);
    const candidateText = analysis.interpretations
      .map((candidate) => `${candidate.title} ${candidate.summary}`.toLowerCase())
      .join(" ");

    expect(analysis.interpretations).toHaveLength(3);
    expect(candidateText).toContain("dentist");
    expect(candidateText).toContain("flights");
    expect(candidateText).toContain("apology email");
    expect(candidateText).not.toContain("interactive dashboard");
  });

  it("refuses when the log cannot ground three distinct interpretations", () => {
    expect(() => analyseWithDemo(conversation(["Write the apology email."]))).toThrow(
      /three distinct tasks/i,
    );
  });

  it("does not turn explicitly forbidden formats into required constraints or semantic support", () => {
    const log = conversation([
      "Book a dentist appointment for next Tuesday.",
      "Compare flights from London to Lisbon.",
      "No CSV, no slides, no dashboard. Write the apology email.",
    ]);
    const input = normalizeProviderAnalysis(analyseWithDemo(log), log);
    const result = rankConversation(input, log.messages, {
      semantic: 0.5,
      constraints: 0.5,
      history: 0,
    });

    expect(input.constraintRules.filter((rule) => rule.mode === "require")).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "format", value: "csv" }),
        expect.objectContaining({ dimension: "format", value: "slides" }),
        expect.objectContaining({ dimension: "format", value: "dashboard" }),
      ]),
    );
    result.ranking
      .filter((candidate) =>
        candidate.features.some((feature) =>
          ["format:csv", "format:slides", "format:dashboard"].includes(feature),
        ),
      )
      .forEach((candidate) => {
        expect(candidate.evidence).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ messageId: "M3", kind: "semantic", sentiment: "supports" }),
          ]),
        );
      });
  });

  it("ignores assistant and system-authored text while retaining role-less fallback messages", () => {
    const log = conversation([
      "Write the apology email.",
      "Book the dentist appointment.",
      "Compare flights to Lisbon.",
      "Publish an executive dashboard.",
    ]);
    log.messages[2].author = "assistant";
    log.messages[3].author = "system";

    expect(() => analyseWithDemo(log)).toThrow(/three distinct tasks/i);
    expect(analyseWithDemo(conversation([
      "Write the apology email.",
      "Book the dentist appointment.",
      "Compare flights to Lisbon.",
    ])).interpretations).toHaveLength(3);
  });

  it("does not turn finance deferrals and scope modifiers into padded candidates", () => {
    const log = conversation([
      "We eventually need a finance monitoring dashboard.",
      "First assess rate limiting for the ingestion service.",
      "Write one concise implementation proposal for rate limiting.",
      "No dashboard yet; defer that work until the proposal is approved.",
      "Include rollout, retry budgets, and ownership in the proposal.",
      "For the deferred dashboard, could MCP help later?",
      "No MCP now, just get the proposal done.",
    ]);

    const analysis = analyseWithDemo(log);
    const titles = analysis.interpretations.map((item) => item.title);

    expect(titles).toContain("Write one concise implementation proposal for rate limiting");
    expect(titles).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^defer/i),
      expect.stringMatching(/^include/i),
      expect.stringMatching(/^no mcp/i),
    ]));
  });
});
