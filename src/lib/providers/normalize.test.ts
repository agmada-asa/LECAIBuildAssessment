/** @file Provider-output normalization and ranker-boundary regression tests. */

import { describe, expect, it } from "vitest";

import { normalizeProviderAnalysis } from "./normalize";
import type { ConversationLog } from "@/lib/conversations/schema";
import { rankConversation } from "@/lib/ranking/engine";
import { DEFAULT_WEIGHTS } from "@/lib/ranking/scenarios";

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
  it("does not accept a conversational acknowledgement as a task boundary", () => {
    const dinnerLog: ConversationLog = {
      conversationId: "dinner",
      userId: "u1",
      messages: [
        { id: "M1", text: "Are we still meeting at the Italian place at 7?", timestamp: "2026-08-14T18:00:00.000Z" },
        { id: "M2", text: "Yeah. I booked a table for two under my name.", timestamp: "2026-08-14T18:01:00.000Z" },
        { id: "M3", text: "Perfect, I'll leave work around 6:30.", timestamp: "2026-08-14T18:02:00.000Z" },
        { id: "M4", text: "Great. See you there.", timestamp: "2026-08-14T18:03:00.000Z" },
      ],
      acceptedOutcomes: [],
    };
    const result = normalizeProviderAnalysis(
      {
        conversationAssessment: {
          kind: "ordinary-conversation",
          summary: "The speakers confirm existing dinner arrangements.",
          evidenceMessageIds: ["M1", "M2", "M3", "M4"],
          knownFacts: ["They plan to meet for dinner."],
          unknowns: [],
        },
        interpretations: [
          {
            id: "ordinary",
            kind: "conversation",
            title: "No actionable task detected",
            summary: "The exchange confirms existing dinner plans.",
            semanticTerms: ["Italian place", "table for two", "see you there"],
            features: ["topic:dinner-plans", "actionability:none"],
          },
          {
            id: "summary",
            kind: "task",
            title: "Summarize the logistics",
            summary: "Summarize the dinner plan.",
            semanticTerms: ["dinner", "restaurant", "logistics"],
            features: ["topic:dinner-plans", "actionability:task"],
          },
          {
            id: "record",
            kind: "task",
            title: "Record the reservation",
            summary: "Record the table booking.",
            semanticTerms: ["reservation", "table", "booking"],
            features: ["topic:dinner-plans", "actionability:task"],
          },
        ],
        constraints: [
          {
            id: "invented-summary",
            phrases: ["See you there"],
            dimension: "task",
            value: "summarize-logistics",
            mode: "require",
            strength: 1,
            label: "Summarize see you there logistics",
          },
        ],
        taskBoundaries: [
          { messageId: "M4", reason: "The final acknowledgement starts a summary task." },
        ],
        notes: "Provider over-interpreted M4.",
      },
      dinnerLog,
    );

    expect(result.taskBoundaries).toEqual([]);
    expect(result.constraintRules).toEqual([]);
  });

  it("creates stable keys and grounds constraints in source messages", () => {
    const result = normalizeProviderAnalysis(validAnalysis, log);

    expect(result.interpretations[0].id).toBe("csv-export");
    expect(result.constraintRules[0].phrases).toEqual(["as CSV"]);
  });

  it("preserves provider-detected task boundaries grounded by source-message ID", () => {
    const result = normalizeProviderAnalysis(
      {
        ...validAnalysis,
        interpretations: validAnalysis.interpretations.map((candidate, index) => ({
          ...candidate,
          features: [
            ...candidate.features,
            `topic:${index === 0 ? "raw-data" : `alternative-${index}`}`,
          ],
        })),
        constraints: [
          ...validAnalysis.constraints,
          {
            id: "raw-data-topic",
            phrases: ["raw rows"],
            dimension: "topic",
            value: "raw-data",
            mode: "require" as const,
            strength: 1,
            label: "Send raw rows",
          },
        ],
        taskBoundaries: [
          { messageId: "M2", reason: "The requested topic changes completely." },
        ],
      },
      log,
    );

    expect(result.taskBoundaries).toEqual([
      { messageId: "M2", reason: "The requested topic changes completely." },
    ]);
  });

  it("rejects a task boundary that is not grounded in a source message", () => {
    expect(() =>
      normalizeProviderAnalysis(
        {
          ...validAnalysis,
          taskBoundaries: [
            { messageId: "missing", reason: "The requested topic changes completely." },
          ],
        },
        log,
      ),
    ).toThrow(/task boundary/i);
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
          {
            ...validAnalysis.constraints[0],
            id: "slides-required",
            phrases: ["produce slides"],
            value: "slides",
            label: "Produce slides",
          },
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

  it("keeps similarly worded candidates when their canonical features conflict", () => {
    const result = normalizeProviderAnalysis(
      {
        ...validAnalysis,
        interpretations: [
          {
            id: "brief-email",
            title: "Send a concise customer update email",
            summary: "Send the customer a concise update email about the current work.",
            semanticTerms: ["customer update", "concise email", "current work"],
            features: ["format:email", "detail:concise"],
          },
          {
            id: "detailed-email",
            title: "Send a detailed customer update email",
            summary: "Send the customer a detailed update email about the current work.",
            semanticTerms: ["customer update", "detailed email", "current work"],
            features: ["format:email", "detail:detailed"],
          },
          validAnalysis.interpretations[2],
        ],
        constraints: [],
      },
      log,
    );

    expect(result.interpretations).toHaveLength(3);
    expect(result.interpretations.map((candidate) => candidate.id)).toEqual([
      "send-a-concise-customer-update-email",
      "send-a-detailed-customer-update-email",
      "dashboard",
    ]);
  });

  it("keeps identically titled candidates when their canonical decisions conflict", () => {
    const result = normalizeProviderAnalysis(
      {
        ...validAnalysis,
        interpretations: [
          { ...validAnalysis.interpretations[0], title: "Customer update", features: ["detail:concise"] },
          { ...validAnalysis.interpretations[1], title: "Customer update", features: ["detail:detailed"] },
          validAnalysis.interpretations[2],
        ],
        constraints: [],
      },
      log,
    );

    expect(result.interpretations).toHaveLength(3);
  });

  it("does not ground provider constraints in assistant-authored text", () => {
    const authoredLog: ConversationLog = {
      ...log,
      messages: log.messages.map((message, index) => ({
        ...message,
        author: index === 0 ? "assistant" : "user",
      })),
    };

    expect(() =>
      normalizeProviderAnalysis(
        {
          ...validAnalysis,
          constraints: [{
            ...validAnalysis.constraints[0],
            phrases: ["produce slides"],
            value: "slides",
            label: "Produce slides",
          }],
        },
        authoredLog,
      ),
    ).toThrow(/not grounded/i);
  });

  it("merges proposal paraphrases before enforcing the distinct-candidate contract", () => {
    expect(() =>
      normalizeProviderAnalysis(
        {
          ...validAnalysis,
          interpretations: [
            {
              id: "proposal-only",
              title: "Proposal only",
              summary: "Deliver the rate-limiting implementation proposal without dashboard work.",
              semanticTerms: ["rate limiting", "proposal", "implementation"],
              features: ["deliverable:proposal", "dashboard:excluded"],
            },
            {
              id: "combined-proposal",
              title: "Combined concise implementation proposal",
              summary: "Deliver one concise rate-limiting implementation proposal; leave the dashboard out.",
              semanticTerms: ["rate limiting", "concise proposal", "implementation"],
              features: ["deliverable:proposal", "dashboard:excluded", "detail:concise"],
            },
            validAnalysis.interpretations[2],
          ],
          constraints: [],
        },
        log,
      ),
    ).toThrow(/three genuinely distinct interpretations/);
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

  it("retains the established subject when a follow-up changes only format and audience", () => {
    const migrationLog: ConversationLog = {
      conversationId: "customer-name-migration",
      userId: "account-lead",
      messages: [
        {
          id: "DB-01",
          text: "We must split the customers.full_name column into given_name and family_name without interrupting writes.",
          timestamp: "2026-08-14T10:00:00.000Z",
        },
        {
          id: "DB-04",
          text: "Produce a machine-readable CSV migration checklist for the release system. Include dual-write, backfill batches, verification queries, rollback gates, and the final column removal.",
          timestamp: "2026-08-14T10:08:00.000Z",
        },
        {
          id: "DB-05",
          text: "Do not make slides; the release bot needs raw rows with an owner and completion condition for every step.",
          timestamp: "2026-08-14T10:10:00.000Z",
        },
        {
          id: "M6",
          text: "Make slides for management",
          timestamp: "2026-08-14T11:33:24.783Z",
        },
      ],
      acceptedOutcomes: [],
    };
    const providerAnalysis = {
      interpretations: [
        {
          id: "unspecified-slides",
          title: "New, unspecified management slide task",
          summary: "Create management slides without carrying forward the migration subject.",
          semanticTerms: ["slides", "management", "new task"],
          features: [
            "topic:unspecified",
            "format:slides",
            "audience:management",
            "coverage:none",
            "metadata:none",
          ],
        },
        {
          id: "migration-slides",
          title: "Management slides for the customer-name migration",
          summary: "Explain the phased customer-name migration in slides for management.",
          semanticTerms: [
            "slides",
            "management",
            "customer-name migration",
            "full_name",
            "dual-write",
          ],
          features: [
            "topic:customer-name-migration",
            "format:slides",
            "audience:management",
          ],
        },
        {
          id: "migration-csv",
          title: "Machine-readable migration checklist",
          summary: "Deliver the migration steps as CSV rows for the release system.",
          semanticTerms: ["CSV", "release system", "raw rows", "migration checklist"],
          features: [
            "topic:customer-name-migration",
            "format:csv",
            "audience:release-system",
          ],
        },
      ],
      constraints: [
        {
          id: "migration-topic",
          phrases: ["full_name"],
          dimension: "topic",
          value: "customer-name-migration",
          mode: "require" as const,
          strength: 1,
          label: "Split the full_name column",
        },
        {
          id: "csv-format",
          phrases: ["machine-readable CSV"],
          dimension: "format",
          value: "csv",
          mode: "require" as const,
          strength: 1,
          label: "Produce machine-readable CSV",
        },
        {
          id: "release-audience",
          phrases: ["release system"],
          dimension: "audience",
          value: "release-system",
          mode: "require" as const,
          strength: 1,
          label: "Deliver to the release system",
        },
        {
          id: "slides-format",
          phrases: ["Make slides"],
          dimension: "format",
          value: "slides",
          mode: "require" as const,
          strength: 1,
          label: "Make slides",
        },
        {
          id: "management-audience",
          phrases: ["management"],
          dimension: "audience",
          value: "management",
          mode: "require" as const,
          strength: 1,
          label: "Present to management",
        },
        {
          id: "invented-coverage",
          phrases: ["Make slides for management"],
          dimension: "coverage",
          value: "none",
          mode: "require" as const,
          strength: 1,
          label: "No migration coverage in replacement task",
        },
        {
          id: "invented-metadata",
          phrases: ["Make slides for management"],
          dimension: "metadata",
          value: "none",
          mode: "require" as const,
          strength: 1,
          label: "No step metadata in replacement task",
        },
      ],
      taskBoundaries: [
        {
          messageId: "M6",
          reason: "The slide request replaces the preceding migration task.",
        },
      ],
      notes: "The provider treated an underspecified follow-up as a new task.",
    };

    const input = normalizeProviderAnalysis(providerAnalysis, migrationLog);
    const result = rankConversation(input, migrationLog.messages, DEFAULT_WEIGHTS);

    expect(input.taskBoundaries).toEqual([]);
    expect(input.constraintRules.map((constraint) => constraint.id)).not.toEqual(
      expect.arrayContaining(["invented-coverage", "invented-metadata"]),
    );
    expect(result.ranking[0].id).toBe("management-slides-for-the-customer-name-migration");
    expect(result.activeConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "topic", value: "customer-name-migration" }),
        expect.objectContaining({ dimension: "format", value: "slides" }),
        expect.objectContaining({ dimension: "audience", value: "management" }),
      ]),
    );
    expect(result.reframes.every((event) => event.kind === "constraint-change")).toBe(true);
  });
});
