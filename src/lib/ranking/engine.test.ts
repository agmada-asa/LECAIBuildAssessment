/**
 * @file Public-behaviour tests for ranking, reframing, abstention, and weights.
 *
 * Assertions target domain invariants instead of brittle floating-point
 * snapshots so scorer internals can be refactored safely.
 */

import { describe, expect, it } from "vitest";

import { extractConstraints, rankConversation, reweightRankingResult } from "./engine";
import { DEFAULT_WEIGHTS } from "./policy";
import { getScenario } from "./test-scenarios";
import type {
  ConstraintRule,
  ConversationMessage,
} from "./types";

/** Builds a timestamped role-neutral message for focused extraction tests. */
function message(id: string, text: string): ConversationMessage {
  return { id, text, timestamp: `2026-08-14T09:0${id.slice(1)}:00.000Z` };
}

/** Builds an inspectable rule without repeating defaults in each regression. */
function rule(
  id: string,
  phrase: string,
  dimension: string,
  value: string,
  mode: ConstraintRule["mode"] = "require",
): ConstraintRule {
  return {
    id,
    phrases: [phrase],
    dimension,
    value,
    mode,
    strength: 1,
    label: `${mode} ${dimension}:${value}`,
  };
}

describe("rankConversation", () => {
  it("requires human review when an actionable catalogue has fewer than three readings", () => {
    const result = rankConversation(
      {
        interpretations: [{
          id: "csv-export",
          kind: "task",
          title: "Export the raw rows as CSV",
          summary: "Send the requested raw rows in CSV format.",
          semanticTerms: ["raw rows", "CSV export", "send CSV"],
          features: ["format:csv"],
        }],
        constraintRules: [rule("csv", "raw rows as CSV", "format", "csv")],
        history: [],
        conversationAssessment: {
          kind: "actionable-task",
          summary: "The user requests a CSV export.",
          evidenceMessageIds: ["M1"],
          knownFacts: ["The raw rows must be sent as CSV."],
          unknowns: [],
        },
      },
      [message("M1", "Send the raw rows as CSV.")],
      DEFAULT_WEIGHTS,
    );

    expect(result.ranking).toHaveLength(1);
    expect(result.humanReviewReason).toEqual({
      code: "insufficient_interpretations",
      message:
        "Only 1 distinct interpretation could be generated. At least 3 are required, so human review is required.",
    });
    expect(result.uncertain).toBe(true);
  });

  it("gates ordinary conversation before ranking invented tasks", () => {
    const messages = [
      message("M1", "Are we still meeting at the Italian place at 7?"),
      message("M2", "Yeah. I booked a table for two under my name."),
      message("M3", "Perfect, I'll leave work around 6:30."),
      message("M4", "Great. See you there."),
    ];
    const result = rankConversation(
      {
        interpretations: [
          {
            id: "ordinary-dinner-plans",
            kind: "conversation",
            title: "No actionable task detected",
            summary: "The exchange confirms existing dinner plans and contains no request for further work.",
            semanticTerms: ["Italian place", "table for two", "see you there"],
            features: ["topic:dinner-plans", "actionability:none"],
          },
          {
            id: "summarize-logistics",
            kind: "task",
            title: "Summarize the complete meetup logistics",
            summary: "Produce an itinerary for the dinner.",
            semanticTerms: ["Italian place", "7", "table for two"],
            features: ["topic:dinner-plans", "actionability:task"],
          },
          {
            id: "record-reservation",
            kind: "task",
            title: "Record the restaurant reservation",
            summary: "Record the table booking details.",
            semanticTerms: ["booked", "table for two", "restaurant"],
            features: ["topic:dinner-plans", "actionability:task"],
          },
        ],
        constraintRules: [],
        history: [],
        conversationAssessment: {
          kind: "ordinary-conversation",
          summary: "The speakers confirm arrangements; neither asks for a new action.",
          evidenceMessageIds: ["M1", "M2", "M3", "M4"],
          knownFacts: ["Dinner is at 7 at the Italian restaurant."],
          unknowns: [],
        },
      },
      messages,
      DEFAULT_WEIGHTS,
    );

    expect(result.ranking[0]).toMatchObject({
      id: "ordinary-dinner-plans",
      kind: "conversation",
      valid: true,
    });
    expect(result.ranking.slice(1).every((candidate) => candidate.valid === false)).toBe(true);
    expect(result.uncertain).toBe(false);
    expect(result.conversationAssessment.kind).toBe("ordinary-conversation");
  });

  it("represents unrecoverable context explicitly instead of overstating a task", () => {
    const result = rankConversation(
      {
        interpretations: [
          {
            id: "insufficient-context",
            kind: "insufficient-context",
            title: "Underlying action cannot be identified",
            summary: "A later explanation is expected, but the action and outcome are unknown.",
            semanticTerms: ["did you do it", "what we expected", "tell me later"],
            features: ["topic:unknown", "actionability:unclear"],
          },
          {
            id: "report-later",
            kind: "task",
            title: "Report the outcome later",
            summary: "Explain an unspecified result later.",
            semanticTerms: ["tell me later", "outcome", "expected"],
            features: ["topic:unknown", "actionability:task"],
          },
          {
            id: "confirm-completion",
            kind: "task",
            title: "Confirm whether it was done",
            summary: "Confirm an unspecified action was completed.",
            semanticTerms: ["did you do it", "yeah", "completed"],
            features: ["topic:unknown", "actionability:task"],
          },
        ],
        constraintRules: [],
        history: [],
        conversationAssessment: {
          kind: "insufficient-context",
          summary: "The referents of ‘it’ and ‘what’ are absent from the supplied messages.",
          evidenceMessageIds: ["M1", "M4", "M5"],
          knownFacts: ["One speaker agreed to explain later."],
          unknowns: ["The completed action", "The outcome being discussed"],
        },
      },
      [
        message("M1", "Did you do it?"),
        message("M2", "Yeah."),
        message("M3", "And?"),
        message("M4", "Pretty much what we expected."),
        message("M5", "Okay. Tell me later."),
        message("M6", "Sure."),
      ],
      DEFAULT_WEIGHTS,
    );

    expect(result.ranking[0].id).toBe("insufficient-context");
    expect(result.humanReviewReason).toMatchObject({ code: "insufficient_context" });
    expect(result.uncertaintyReason).toMatch(/cannot be recovered/i);
    expect(result.clarificationQuestion).toBeUndefined();
  });

  it("uses the whole exchange when ranking ordinary-conversation readings", () => {
    const result = rankConversation(
      {
        interpretations: [
          {
            id: "whole-party",
            kind: "conversation",
            title: "Discussion of Maya's surprise birthday gathering",
            summary: "The speakers coordinate a secret birthday gathering at 8, a dinner cover story, and cake.",
            semanticTerms: ["Maya", "surprise", "birthday", "coming over at 8", "dinner", "cake"],
            features: ["topic:surprise-party", "scope:whole-exchange"],
          },
          {
            id: "cake-only",
            kind: "conversation",
            title: "Personal commitment to bring the cake",
            summary: "The final speaker says they will bring cake.",
            semanticTerms: ["bring the cake", "cake", "commitment"],
            features: ["topic:cake", "scope:latest-message"],
          },
          {
            id: "cover-story",
            kind: "conversation",
            title: "Dinner cover story",
            summary: "Maya thinks the group is only going out for dinner.",
            semanticTerms: ["Maya", "dinner", "no idea", "cover story"],
            features: ["topic:cover-story", "scope:partial"],
          },
        ],
        constraintRules: [],
        history: [],
        conversationAssessment: {
          kind: "ordinary-conversation",
          summary: "The exchange coordinates a birthday surprise without requesting agent work.",
          evidenceMessageIds: ["M1", "M2", "M3", "M4"],
          knownFacts: ["The gathering is at 8 and one speaker will bring cake."],
          unknowns: [],
        },
      },
      [
        message("M1", "Don't tell Maya, but everyone is coming over at 8 for her birthday."),
        message("M2", "Got it. Does she still think we're just going out for dinner?"),
        message("M3", "Yeah, she has no idea about the surprise."),
        message("M4", "Perfect. I'll bring the cake."),
      ],
      { semantic: 100, constraints: 0, history: 0 },
    );

    expect(result.ranking[0].id).toBe("whole-party");
  });

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
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS, scenario);

    expect(result.ranking[0].id).toBe("csv-export");
    expect(result.ranking[0].previousRank).toBeGreaterThan(1);
    expect(result.reframes.length).toBeGreaterThan(0);
    expect(result.explanation).toContain("replacing");
  });

  it("preserves every previous score and returns per-axis, total, confidence, and rank deltas", () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS, scenario);

    expect(result.ranking).toHaveLength(3);
    result.ranking.forEach((candidate) => {
      expect(candidate.previous).toEqual(
        expect.objectContaining({
          rank: expect.any(Number),
          signals: expect.objectContaining({
            semantic: expect.any(Number),
            constraints: expect.any(Number),
            history: expect.any(Number),
          }),
          total: expect.any(Number),
          confidence: expect.any(Number),
        }),
      );
      expect(candidate.deltas).toEqual(
        expect.objectContaining({
          semantic: expect.any(Number),
          constraints: expect.any(Number),
          history: expect.any(Number),
          total: expect.any(Number),
          confidence: expect.any(Number),
          rank: expect.any(Number),
        }),
      );
      expect(candidate.change?.messageId).toBe("M3");
      expect(candidate.explanation).toContain(`#${candidate.rank}`);
    });
  });

  it("explains the previous winner falling, the new winner rising, and the selected weight", () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS, scenario);

    expect(result.rankingChange).toMatchObject({
      messageId: "M3",
      winnerChanged: true,
      previousWinner: { id: "slide-deck" },
      currentWinner: { id: "csv-export" },
    });
    expect(result.rankingChange?.previousWinnerExplanation).toContain("fell");
    expect(result.rankingChange?.currentWinnerExplanation).toContain("rose");
    expect(result.mostInfluentialAxis).toMatchObject({
      key: "constraints",
      weight: 0.5,
    });
    expect(result.mostInfluentialAxis.explanation).toContain("explicit instructions");
  });

  it("does not claim the winner rose or fell when it remains first", () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(
      scenario,
      scenario.messages.slice(0, 2),
      DEFAULT_WEIGHTS,
      scenario,
    );

    expect(result.rankingChange).toMatchObject({ winnerChanged: false });
    expect(result.rankingChange?.previousWinnerExplanation).not.toContain("fell");
    expect(result.rankingChange?.currentWinnerExplanation).not.toContain("rose");
    expect(result.rankingChange?.currentWinnerExplanation).toContain("remained #1");
  });

  it("scores only messages from the current task after a provider boundary", () => {
    const result = rankConversation(
      {
        interpretations: [
          {
            id: "database",
            title: "Investigate the database",
            summary: "Diagnose replication lag and prepare a runbook.",
            semanticTerms: ["replication", "database", "diagnostics", "runbook"],
            features: ["topic:database"],
          },
          {
            id: "poem",
            title: "Write a poem",
            summary: "Write the newly requested poem.",
            semanticTerms: ["poem", "verse", "rhyme", "stanza"],
            features: ["topic:poem"],
          },
          {
            id: "checklist",
            title: "Create a checklist",
            summary: "Create an unrelated checklist.",
            semanticTerms: ["checklist", "steps", "tasks", "items"],
            features: ["topic:checklist"],
          },
        ],
        constraintRules: [],
        history: [],
        taskBoundaries: [{ messageId: "M2", reason: "The user requested a new task." }],
      },
      [
        message("M1", "Investigate replication database diagnostics and write a runbook."),
        message("M2", "Write a poem."),
      ],
      { semantic: 100, constraints: 0, history: 0 },
    );

    expect(result.ranking[0].id).toBe("poem");
    expect(
      result.ranking.find((candidate) => candidate.id === "database")?.evidence,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageId: "M1", kind: "semantic" }),
      ]),
    );
  });

  it("applies a none-of-the-above gate before assigning relative confidence", () => {
    const result = rankConversation(
      {
        interpretations: [
          { id: "csv", title: "Export CSV", summary: "Export rows.", semanticTerms: ["CSV", "rows", "export"], features: ["format:csv"] },
          { id: "slides", title: "Make slides", summary: "Create a deck.", semanticTerms: ["slides", "deck", "presentation"], features: ["format:slides"] },
          { id: "dashboard", title: "Build dashboard", summary: "Build a dashboard.", semanticTerms: ["dashboard", "monitor", "interactive"], features: ["format:dashboard"] },
        ],
        constraintRules: [],
        history: [],
      },
      [message("M1", "Book my dentist appointment for next Tuesday.")],
      { semantic: 1, constraints: 0, history: 0 },
    );

    expect(result.humanReviewReason?.code).toBe("none_above");
    expect(result.ranking.every((candidate) => candidate.confidence === 0)).toBe(true);
    expect(result.clarificationQuestion).toBeUndefined();
  });

  it("does not score assistant or system-authored messages as user instructions", () => {
    const result = rankConversation(
      {
        interpretations: [
          { id: "email", title: "Write apology email", summary: "Write an apology.", semanticTerms: ["apology email", "apology", "email"], features: ["format:email"] },
          { id: "slides", title: "Make slides", summary: "Create a deck.", semanticTerms: ["slides", "deck", "presentation"], features: ["format:slides"] },
          { id: "dashboard", title: "Build dashboard", summary: "Build a dashboard.", semanticTerms: ["dashboard", "monitor", "interactive"], features: ["format:dashboard"] },
        ],
        constraintRules: [rule("slides", "make slides", "format", "slides")],
        history: [],
      },
      [
        { ...message("M1", "Write the apology email."), author: "user" },
        { ...message("M2", "Make slides."), author: "assistant" },
        { ...message("M3", "Build dashboard."), author: "system" },
      ],
      DEFAULT_WEIGHTS,
    );

    expect(result.ranking[0].id).toBe("email");
    expect(result.constraints).toHaveLength(0);
    expect(result.processedMessageCount).toBe(3);
  });

  it("keeps stale candidates in human review after local reweighting", () => {
    const source = rankConversation(
      {
        interpretations: [
          {
            id: "database",
            title: "Investigate the database",
            summary: "Diagnose database reliability.",
            semanticTerms: ["database", "reliability"],
            features: ["topic:database"],
          },
          {
            id: "sales",
            title: "Prepare a sales forecast",
            summary: "Forecast future sales.",
            semanticTerms: ["sales", "forecast"],
            features: ["topic:sales"],
          },
          {
            id: "report",
            title: "Write a status report",
            summary: "Summarise current status.",
            semanticTerms: ["status", "report"],
            features: ["topic:reporting"],
          },
        ],
        constraintRules: [
          rule("onboarding", "welcome email", "topic", "employee-onboarding"),
        ],
        history: [],
        taskBoundaries: [{ messageId: "M2", reason: "The task changed to onboarding." }],
      },
      [
        message("M1", "Investigate database reliability."),
        message("M2", "Write a welcome email for new employees."),
      ],
      DEFAULT_WEIGHTS,
    );
    const ranking = source.ranking.map((candidate, index) => ({
      ...candidate,
      signals: {
        ...candidate.signals,
        history: index === 0 ? 1 : 0,
      },
    }));

    const reweighted = reweightRankingResult(
      { ...source, ranking },
      { semantic: 0, constraints: 0, history: 100 },
    );

    expect(source.humanReviewReason?.code).toBe("stale_candidates");
    expect(reweighted.humanReviewReason?.code).toBe("stale_candidates");
    expect(reweighted.uncertain).toBe(true);
  });

  it("compares a follow-up with the candidate catalogue shown by the prior run", () => {
    const previousInput = {
      interpretations: [
        {
          id: "database",
          title: "Investigate the database",
          summary: "Diagnose replication lag and prepare a runbook.",
          semanticTerms: ["replication lag", "database", "diagnostics", "runbook"],
          features: ["topic:database"],
        },
        {
          id: "status-page",
          title: "Update the status page",
          summary: "Publish a database incident update.",
          semanticTerms: ["status page", "incident", "update", "database"],
          features: ["topic:status-page"],
        },
        {
          id: "capacity-plan",
          title: "Prepare a capacity plan",
          summary: "Plan database capacity changes.",
          semanticTerms: ["capacity", "plan", "database", "scaling"],
          features: ["topic:capacity"],
        },
      ],
      constraintRules: [],
      history: [],
    };
    const currentInput = {
      interpretations: [
        {
          id: "poem",
          title: "Write a poem",
          summary: "Write the newly requested poem.",
          semanticTerms: ["poem", "verse", "rhyme", "stanza"],
          features: ["topic:poem"],
        },
        {
          id: "story",
          title: "Write a story",
          summary: "Write a short fictional story.",
          semanticTerms: ["story", "fiction", "character", "plot"],
          features: ["topic:story"],
        },
        {
          id: "speech",
          title: "Write a speech",
          summary: "Write a concise speech.",
          semanticTerms: ["speech", "remarks", "audience", "talk"],
          features: ["topic:speech"],
        },
      ],
      constraintRules: [],
      history: [],
      taskBoundaries: [{ messageId: "M2", reason: "The user replaced the database task." }],
    };
    const result = rankConversation(
      currentInput,
      [
        message("M1", "Investigate database replication lag and prepare a diagnostic runbook."),
        message("M2", "Write a poem with rhyme and four short stanzas."),
      ],
      { semantic: 100, constraints: 0, history: 0 },
      previousInput,
    );

    expect(result.rankingChange).toMatchObject({
      winnerChanged: true,
      previousWinner: { id: "database" },
      currentWinner: { id: "poem" },
    });
    expect(result.rankingChange?.previousWinnerExplanation).toContain(
      "no longer returned",
    );
    expect(result.rankingChange?.currentWinnerExplanation).toContain(
      "newly introduced",
    );
    expect(result.ranking.every((candidate) => candidate.previous === undefined)).toBe(true);
  });

  it("retrospectively compares a complete initial import with its preceding prefix", () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS);

    expect(result.rankingChange).toMatchObject({
      winnerChanged: true,
      previousWinner: { id: "slide-deck" },
      currentWinner: { id: result.ranking[0].id },
    });
    expect(result.ranking.every((candidate) => candidate.previous !== undefined)).toBe(true);
    expect(result.ranking.every((candidate) => candidate.deltas !== undefined)).toBe(true);
  });

  it("matches paraphrased candidates across provider reruns by canonical decision", () => {
    const previousInput = {
      interpretations: [
        {
          id: "send-report-old",
          title: "Send the weekly report",
          summary: "Email leadership a weekly performance report.",
          semanticTerms: ["weekly report", "leadership", "email"],
          features: ["topic:performance", "format:report", "audience:leadership"],
        },
        {
          id: "dashboard-old",
          title: "Publish the dashboard",
          summary: "Publish a live performance dashboard.",
          semanticTerms: ["performance", "dashboard", "live"],
          features: ["topic:performance", "format:dashboard", "audience:operations"],
        },
        {
          id: "spreadsheet-old",
          title: "Maintain the spreadsheet",
          summary: "Maintain a shared performance spreadsheet.",
          semanticTerms: ["performance", "spreadsheet", "shared"],
          features: ["topic:performance", "format:spreadsheet", "audience:operations"],
        },
      ],
      constraintRules: [],
      history: [],
    };
    const currentInput = {
      ...previousInput,
      interpretations: [
        {
          ...previousInput.interpretations[0],
          id: "email-leadership-update-new",
          title: "Email leadership the weekly update",
        },
        {
          ...previousInput.interpretations[1],
          id: "live-view-new",
          title: "Create a live performance view",
        },
        {
          ...previousInput.interpretations[2],
          id: "shared-tracker-new",
          title: "Keep a shared performance tracker",
        },
      ],
    };
    const result = rankConversation(
      currentInput,
      [
        message("M1", "Send the weekly performance report to leadership."),
        message("M2", "Email it to leadership every Monday."),
      ],
      DEFAULT_WEIGHTS,
      previousInput,
    );

    expect(result.ranking.every((candidate) => candidate.previous !== undefined)).toBe(true);
    expect(result.rankingChange).toMatchObject({ winnerChanged: false });
    expect(result.rankingChange?.currentWinnerExplanation).toContain("remained #1");
    expect(result.rankingChange?.currentWinnerExplanation).not.toContain("newly introduced");
  });

  it("does not reuse a title-derived ID when its canonical decision conflicts", () => {
    const previousInput = {
      interpretations: [
        {
          id: "prepare-the-update",
          title: "Prepare the update",
          summary: "Prepare the update as presentation slides.",
          semanticTerms: ["prepare update", "presentation", "slides"],
          features: ["format:slides"],
        },
        {
          id: "prepare-the-memo",
          title: "Prepare the memo",
          summary: "Prepare a written update memo.",
          semanticTerms: ["prepare update", "memo", "written"],
          features: ["format:memo"],
        },
        {
          id: "prepare-the-dashboard",
          title: "Prepare the dashboard",
          summary: "Prepare an interactive update dashboard.",
          semanticTerms: ["prepare update", "dashboard", "interactive"],
          features: ["format:dashboard"],
        },
      ],
      constraintRules: [
        rule("slides-required", "slides", "format", "slides"),
      ],
      history: [],
    };
    const currentInput = {
      interpretations: [
        {
          ...previousInput.interpretations[0],
          summary: "Prepare the update as a machine-readable CSV export.",
          semanticTerms: ["prepare update", "machine-readable", "CSV"],
          features: ["format:csv"],
        },
        previousInput.interpretations[1],
        previousInput.interpretations[2],
      ],
      constraintRules: [
        ...previousInput.constraintRules,
        rule("csv-required", "CSV instead", "format", "csv"),
      ],
      history: [],
    };
    const result = rankConversation(
      currentInput,
      [
        message("M1", "Prepare the update as slides."),
        message("M2", "Prepare the update as CSV instead."),
      ],
      { semantic: 0, constraints: 100, history: 0 },
      previousInput,
    );
    const csv = result.ranking.find((candidate) => candidate.id === "prepare-the-update");

    expect(csv?.rank).toBe(1);
    expect(csv?.previousRank).toBeUndefined();
    expect(csv?.previous).toBeUndefined();
    expect(csv?.deltas).toBeUndefined();
    expect(result.rankingChange).toMatchObject({
      winnerChanged: true,
      previousWinner: { id: "prepare-the-update" },
      currentWinner: { id: "prepare-the-update" },
    });
    expect(result.rankingChange?.currentWinnerExplanation).toContain("newly introduced");
    expect(result.rankingChange?.currentWinnerExplanation).not.toContain("remained #1");
  });

  it("reports the axis that actually separates the leading candidates", () => {
    const input = {
      interpretations: [
        {
          id: "report",
          title: "Write the incident report",
          summary: "Write a report about the incident.",
          semanticTerms: ["incident report", "write report", "incident"],
          features: ["format:report"],
        },
        {
          id: "dashboard",
          title: "Build an incident dashboard",
          summary: "Build a dashboard for the incident.",
          semanticTerms: ["incident dashboard", "dashboard", "monitor"],
          features: ["format:dashboard"],
        },
        {
          id: "slides",
          title: "Prepare incident slides",
          summary: "Prepare slides about the incident.",
          semanticTerms: ["incident slides", "slides", "presentation"],
          features: ["format:slides"],
        },
      ],
      constraintRules: [],
      history: [],
    };
    const result = rankConversation(
      input,
      [message("M1", "Write the incident report now.")],
      DEFAULT_WEIGHTS,
    );

    expect(result.mostInfluentialAxis.key).toBe("semantic");
    expect(result.mostInfluentialAxis.explanation).toMatch(/separat/i);
    expect(result.mostInfluentialAxis.explanation).toContain(
      "constraint consistency most heavily (50%)",
    );
    expect(result.mostInfluentialAxis.explanation).not.toContain(
      "current conversational language the largest share",
    );
  });

  it("separates changed evidence from evidence that remained applicable", () => {
    const scenario = getScenario("finance-reframe");
    const result = rankConversation(scenario, scenario.messages, DEFAULT_WEIGHTS, scenario);
    const csv = result.ranking.find((candidate) => candidate.id === "csv-export")!;

    expect(csv.change?.addedEvidence.some((evidence) => evidence.messageId === "M3")).toBe(true);
    expect(csv.change?.unchangedEvidence).toEqual(expect.any(Array));
    expect(csv.evidence.some((evidence) => evidence.sentiment === "supports")).toBe(true);
    expect(
      result.ranking
        .find((candidate) => candidate.id === "slide-deck")
        ?.evidence.some((evidence) => evidence.sentiment === "conflicts"),
    ).toBe(true);
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

  it("does not describe an old reframe as the latest change after an unrelated message", () => {
    const scenario = getScenario("finance-reframe");
    const messages = [
      ...scenario.messages,
      message("M4", "Thanks, please use the usual secure transfer channel."),
    ];
    const result = rankConversation(scenario, messages, DEFAULT_WEIGHTS);

    expect(result.latestReframe).toBeUndefined();
    expect(result.explanation).not.toContain("latest reframe");
    expect(result.reframes.length).toBeGreaterThan(0);
  });
});

describe("extractConstraints", () => {
  it("invalidates prior constraints at a task boundary without replacement constraints", () => {
    const result = extractConstraints(
      [message("M1", "Make slides."), message("M2", "Surprise me with a new task.")],
      [rule("slides", "make slides", "format", "slides")],
      [{ messageId: "M2", reason: "The user requested an unrelated task." }],
    );

    expect(result.activeConstraints).toHaveLength(0);
    expect(result.constraints[0]).toMatchObject({ superseded: true });
  });

  it("replaces slides with CSV as the active format value", () => {
    const rules = [
      rule("slides", "make slides", "format", "slides"),
      rule("csv", "send a CSV", "format", "csv"),
    ];
    const result = extractConstraints(
      [message("M1", "Please make slides."), message("M2", "Send a CSV instead.")],
      rules,
    );

    expect(result.activeConstraints).toEqual([
      expect.objectContaining({ value: "csv", messageId: "M2" }),
    ]);
    expect(result.reframes[0]).toMatchObject({
      messageId: "M2",
      previousConstraint: { value: "slides", messageId: "M1" },
      replacementConstraint: { value: "csv", messageId: "M2" },
    });
  });

  it("allows PowerPoint after an earlier no-slides instruction", () => {
    const rules = [
      rule("no-slides", "no slides", "format", "slides", "forbid"),
      rule("powerpoint", "PowerPoint after all", "format", "slides"),
    ];
    const result = extractConstraints(
      [message("M1", "No slides."), message("M2", "Make it PowerPoint after all.")],
      rules,
    );

    expect(result.activeConstraints[0]).toMatchObject({ mode: "require", value: "slides" });
    expect(result.reframes[0]).toMatchObject({
      previousConstraint: { mode: "forbid", matchedPhrase: "No slides" },
      replacementConstraint: { mode: "require", matchedPhrase: "PowerPoint after all" },
    });
  });

  it("replaces client review with finance ingestion in the purpose dimension", () => {
    const rules = [
      rule("review", "client review", "purpose", "client-review"),
      rule("finance", "finance ingestion", "purpose", "finance-ingestion"),
    ];
    const result = extractConstraints(
      [message("M1", "Prepare a client review."), message("M2", "This is for finance ingestion.")],
      rules,
    );

    expect(result.activeConstraints[0]).toMatchObject({ value: "finance-ingestion" });
    expect(result.constraints.find((item) => item.value === "client-review")?.superseded).toBe(true);
  });

  it("supersedes every earlier dimension after an explicit complete task switch", () => {
    const rules = [
      rule("slides", "make slides", "format", "slides"),
      rule("charts", "include charts", "content", "charts"),
      rule("guidance", "write retry guidance", "purpose", "retry-guidance"),
    ];
    const result = extractConstraints(
      [
        message("M1", "Make slides and include charts."),
        message("M2", "Forget the previous task. Write retry guidance for API clients."),
      ],
      rules,
    );

    expect(result.activeConstraints).toEqual([
      expect.objectContaining({ value: "retry-guidance", messageId: "M2" }),
    ]);
    expect(result.constraints.filter((item) => item.messageId === "M1").every((item) => item.superseded)).toBe(true);
    expect(result.reframes.every((event) => event.kind === "task-switch")).toBe(true);
  });

  it("does not clear the task for negated, quoted, or reported reset phrases", () => {
    const rules = [rule("slides", "make slides", "format", "slides")];
    const result = extractConstraints(
      [
        message("M1", "Please make slides."),
        message("M2", "Do not ignore the previous task; continue it."),
        message("M3", 'The policy says "ignore the previous task" is not our instruction.'),
      ],
      rules,
    );

    expect(result.activeConstraints).toEqual([
      expect.objectContaining({ value: "slides", messageId: "M1" }),
    ]);
    expect(result.constraints[0].superseded).toBe(false);
  });

  it("uses a provider-grounded task boundary for an unrelated topic switch without cue words", () => {
    const rules = [
      rule("database", "replication lag", "topic", "database-reliability"),
      rule("runbook", "diagnostic runbook", "format", "runbook"),
      rule("onboarding", "welcome email", "topic", "employee-onboarding"),
      rule("friendly", "friendly", "tone", "friendly"),
    ];
    const messages = [
      message("M1", "Investigate replication lag and prepare a diagnostic runbook."),
      message("M2", "Write a friendly welcome email for new employees."),
    ];
    const result = extractConstraints(messages, rules, [
      {
        messageId: "M2",
        reason: "The requested work changes from database reliability to employee onboarding.",
      },
    ]);

    expect(result.activeConstraints).toHaveLength(2);
    expect(result.activeConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "topic", value: "employee-onboarding" }),
        expect.objectContaining({ dimension: "tone", value: "friendly" }),
      ]),
    );
    expect(result.constraints.filter((item) => item.messageId === "M1").every((item) => item.superseded)).toBe(true);
    expect(result.reframes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "task-switch", messageId: "M2" }),
      ]),
    );
  });

  it("handles a paraphrased reversal", () => {
    const rules = [
      rule("slides", "presentation", "format", "slides"),
      rule("csv", "spreadsheet export", "format", "csv"),
    ];
    const result = extractConstraints(
      [
        message("M1", "Prepare a presentation."),
        message("M2", "Scrap the deck; a spreadsheet export works better."),
      ],
      rules,
    );

    expect(result.reframes).toHaveLength(1);
    expect(result.activeConstraints[0]).toMatchObject({ value: "csv" });
  });

  it("does not extract a positive rule from an explicitly negated phrase", () => {
    const rules = [
      rule("slides", "slides", "format", "slides"),
      rule("no-slides", "no slides", "format", "slides", "forbid"),
    ];
    const result = extractConstraints([message("M1", "No slides, please.")], rules);

    expect(result.constraints).toHaveLength(1);
    expect(result.constraints[0]).toMatchObject({ id: "no-slides", mode: "forbid" });
  });

  it("does not treat quoted or reported instructions as new constraints", () => {
    const rules = [
      rule("slides", "make slides", "format", "slides"),
      rule("csv", "keep the CSV", "format", "csv"),
    ];
    const result = extractConstraints(
      [
        message("M1", "Keep the CSV."),
        message("M2", "The old brief says \"make slides\"; keep the CSV."),
        message("M3", "You previously said make slides, which I am quoting for the audit."),
      ],
      rules,
    );

    expect(result.reframes).toHaveLength(0);
    expect(result.activeConstraints[0]).toMatchObject({ value: "csv" });
    expect(result.constraints.some((item) => item.value === "slides")).toBe(false);
  });

  it("uses a later actionable occurrence after the same phrase is quoted", () => {
    const rules = [rule("slides", "make slides", "format", "slides")];
    const result = extractConstraints(
      [
        message(
          "M1",
          'The old brief says "make slides", but the current instruction is to make slides.',
        ),
      ],
      rules,
    );

    expect(result.activeConstraints[0]).toMatchObject({
      value: "slides",
      matchedPhrase: "make slides",
    });
  });

  it("uses the latest source message when the same active value is restated", () => {
    const rules = [rule("csv", "CSV", "format", "csv")];
    const result = extractConstraints(
      [message("M1", "Send CSV."), message("M2", "CSV remains the required format.")],
      rules,
    );

    expect(result.reframes).toHaveLength(0);
    expect(result.activeConstraints[0]).toMatchObject({ messageId: "M2", matchedPhrase: "CSV" });
    expect(result.constraints[0].superseded).toBe(true);
  });
});
