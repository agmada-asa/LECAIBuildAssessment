/**
 * @file Public-behaviour tests for ranking, reframing, abstention, and weights.
 *
 * Assertions target domain invariants instead of brittle floating-point
 * snapshots so scorer internals can be refactored safely.
 */

import { describe, expect, it } from "vitest";

import { extractConstraints, rankConversation } from "./engine";
import { DEFAULT_WEIGHTS, getScenario } from "./scenarios";
import type { ConstraintRule, ConversationMessage } from "./types";

describe("rankConversation", () => {
  it("ranks the review deck first before the user reframes the task", () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(
      scenario,
      scenario.messages.slice(0, 2),
      DEFAULT_WEIGHTS,
    );

    expect(result.ranking[0].id).toBe("slide-deck");
    expect(result.reframes).toHaveLength(0);
  });

  it("moves the CSV export to first after the explicit contradiction", () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);

    expect(result.ranking[0].id).toBe("csv-export");
    expect(result.ranking[0].previousRank).toBeGreaterThan(1);
    expect(result.reframes.length).toBeGreaterThan(0);
    expect(result.explanation).toContain("replacing");
  });

  it("flags the deliberately ambiguous weekly request for human review", () => {
    const scenario = getScenario("weekly-ambiguity");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);

    expect(
      result.uncertain,
      JSON.stringify(result.ranking, null, 2),
    ).toBe(true);
    expect(result.uncertaintyReason).toBeTruthy();
  });

  it("changes the weighted total when a user selects a history-heavy profile", () => {
    const scenario = getScenario("finance-reframe");
    const messages = scenario.messages.slice(0, 2);
    const defaultResult = rankConversation(scenario, messages, DEFAULT_WEIGHTS);
    const historyResult = rankConversation(scenario, messages, {
      semantic: 20,
      constraints: 20,
      history: 60,
    });

    expect(historyResult.ranking[0].total).not.toBe(defaultResult.ranking[0].total);
  });

  it("reports a detected reversal without requiring special reframe wording", () => {
    const scenario = getScenario("finance-reframe");
    const messages: ConversationMessage[] = [
      {
        id: "M1",
        author: "user",
        text: "Please make this a slide deck.",
        timestamp: "09:00",
      },
      {
        id: "M2",
        author: "user",
        text: "No slides. Finance needs raw rows.",
        timestamp: "09:01",
      },
    ];
    const rules: ConstraintRule[] = [
      {
        id: "slides-required",
        phrases: ["slide deck"],
        dimension: "format",
        value: "slides",
        mode: "require",
        strength: 1,
        label: "Produce slides",
      },
      {
        id: "slides-forbidden",
        phrases: ["no slides"],
        dimension: "format",
        value: "slides",
        mode: "forbid",
        strength: 1,
        label: "Do not produce slides",
      },
    ];
    const result = rankConversation(
      { ...scenario, constraintRules: rules },
      messages,
      DEFAULT_WEIGHTS,
    );

    expect(extractConstraints(messages, rules).reframes).toHaveLength(1);
    expect(result.reframes).toHaveLength(1);
    expect(result.explanation).toContain("superseded an earlier constraint");
  });

  it("describes the effective normalised weight rather than the raw input", () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages.slice(0, 2), {
      semantic: 60,
      constraints: 60,
      history: 60,
    });

    expect(result.explanation).toContain("(33%)");
    expect(result.explanation).not.toContain("(60%)");
  });

  it("falls back to equal influence when every supplied weight is zero", () => {
    const scenario = getScenario("finance-reframe");
    const messages = scenario.messages.slice(0, 2);
    const zeroWeightResult = rankConversation(scenario, messages, {
      semantic: 0,
      constraints: 0,
      history: 0,
    });
    const equalWeightResult = rankConversation(scenario, messages, {
      semantic: 1,
      constraints: 1,
      history: 1,
    });

    expect(zeroWeightResult.ranking).toEqual(equalWeightResult.ranking);
  });

  it("extracts constraints without requiring an author role", () => {
    const rules: ConstraintRule[] = [
      {
        id: "slides-required",
        phrases: ["make slides"],
        dimension: "format",
        value: "slides",
        mode: "require",
        strength: 1,
        label: "Produce slides",
      },
    ];
    const messages: ConversationMessage[] = [
      {
        id: "M1",
        text: "I could make slides.",
        timestamp: "09:00",
      },
    ];

    expect(extractConstraints(messages, rules).constraints).toHaveLength(1);
  });

  it("treats a zero-strength constraint set as neutral", () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(
      {
        ...scenario,
        constraintRules: scenario.constraintRules.map((rule) => ({
          ...rule,
          strength: 0,
        })),
      },
      scenario.messages,
      DEFAULT_WEIGHTS,
    );

    expect(result.ranking.every((item) => item.signals.constraints === 0.5)).toBe(true);
    expect(result.ranking.every((item) => Number.isFinite(item.total))).toBe(true);
  });
});
