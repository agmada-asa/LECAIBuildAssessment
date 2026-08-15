/** @file P1 scorer tests for embeddings, history retrieval, and semantic evidence. */

import { describe, expect, it } from "vitest";

import { rankConversation } from "./engine";
import { constraintScore } from "./scoring";
import type { ConversationMessage, RankingInput } from "./types";

const input: RankingInput = {
  interpretations: [
    {
      id: "slides",
      title: "Create a slide presentation",
      summary: "Prepare a visual presentation for the meeting.",
      semanticTerms: ["slides", "deck", "PowerPoint", "presentation"],
      features: ["format:slides"],
    },
    {
      id: "csv",
      title: "Export CSV data",
      summary: "Send machine-readable rows.",
      semanticTerms: ["CSV", "raw rows", "data export"],
      features: ["format:csv"],
    },
    {
      id: "email",
      title: "Write an email",
      summary: "Send a written update by email.",
      semanticTerms: ["email", "written update", "message"],
      features: ["format:email"],
    },
  ],
  constraintRules: [],
  history: [],
};

function message(id: string, text: string): ConversationMessage {
  return { id, text, timestamp: `2026-08-14T09:0${id.slice(1)}:00.000Z` };
}

describe("embedding semantic scoring", () => {
  it.each(["slides", "deck", "PowerPoint", "presentation"])(
    "ranks the presentation interpretation for %s",
    (term) => {
      const result = rankConversation(input, [message("M1", `Please prepare a ${term}.`)], {
        semantic: 1,
        constraints: 0,
        history: 0,
      });

      expect(result.ranking[0].id).toBe("slides");
      expect(result.semanticModel).toMatchObject({
        name: "resolve-local-feature-hash",
        version: "1.0.0",
      });
      expect(result.ranking[0].evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "semantic",
            messageId: "M1",
            source: "embedding",
          }),
        ]),
      );
    },
  );

  it("uses documented recency weighting and retains the closest message", () => {
    const result = rankConversation(
      input,
      [message("M1", "Prepare a slide deck."), message("M2", "Actually export raw CSV rows.")],
      { semantic: 1, constraints: 0, history: 0 },
    );
    const csv = result.ranking.find((candidate) => candidate.id === "csv")!;

    expect(result.ranking[0].id).toBe("csv");
    expect(csv.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "semantic", messageId: "M2" }),
      ]),
    );
  });

  it("matches accepted history by meaning without requiring candidate IDs", () => {
    const result = rankConversation(
      {
        ...input,
        history: [
          {
            id: "outcome-1",
            summary: "Leadership PowerPoint deck for the monthly meeting",
            terms: ["leadership", "PowerPoint", "monthly meeting"],
            accepted: true,
          },
        ],
      },
      [message("M1", "Prepare the monthly leadership update")],
      { semantic: 0, constraints: 0, history: 1 },
    );

    expect(result.ranking[0].id).toBe("slides");
    expect(result.ranking[0].evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "history", provenanceId: "outcome-1" }),
      ]),
    );
  });

  it("does not use an explicitly negated term as lexical or embedding support", () => {
    const result = rankConversation(
      input,
      [message("M1", "No CSV. Write the apology email instead.")],
      { semantic: 1, constraints: 0, history: 0 },
    );
    const csv = result.ranking.find((candidate) => candidate.id === "csv")!;

    expect(csv.evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageId: "M1", kind: "semantic", sentiment: "supports" }),
      ]),
    );
  });
});

describe("constraint scoring", () => {
  it("scores exact required features above direct conflicts", () => {
    const constraint = {
      id: "format-csv",
      phrases: ["CSV"],
      dimension: "format",
      value: "csv",
      mode: "require" as const,
      strength: 1,
      label: "Deliver CSV",
      messageId: "M1",
      messageIndex: 0,
      matchedPhrase: "CSV",
      superseded: false,
    };

    expect(constraintScore(input.interpretations[1], [constraint]).score).toBe(1);
    expect(constraintScore(input.interpretations[0], [constraint]).score).toBeLessThan(0.2);
    expect(constraintScore(input.interpretations[1], [constraint]).evidence[0].text).toBe(
      "Source: “CSV”",
    );
  });

  it("only calls a prohibition supportive when the candidate explicitly excludes it", () => {
    const constraint = {
      id: "no-dashboard",
      phrases: ["No dashboard yet"],
      dimension: "dashboard",
      value: "required",
      mode: "forbid" as const,
      strength: 1,
      label: "No dashboard yet",
      messageId: "M1",
      messageIndex: 0,
      matchedPhrase: "No dashboard yet",
      superseded: false,
    };
    const explicitExclusion = {
      ...input.interpretations[2],
      features: ["format:email", "dashboard:excluded"],
    };
    const unspecified = input.interpretations[2];

    expect(constraintScore(explicitExclusion, [constraint]).evidence).toEqual([
      expect.objectContaining({ sentiment: "supports", source: "constraint" }),
    ]);
    expect(constraintScore(unspecified, [constraint]).evidence).toEqual([]);
  });
});
