/**
 * @file Test-only conversational scenarios and accepted-task history.
 *
 * These records exercise the production ranking engine in automated tests.
 * Runtime application code must never import this module.
 */

import type {
  ConstraintRule,
  ConversationMessage,
  HistoricalTask,
  Interpretation,
  RankingInput,
} from "./types";

type TestScenario = RankingInput & {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  userName: string;
  userRole: string;
  messages: ConversationMessage[];
  interpretations: Interpretation[];
  constraintRules: ConstraintRule[];
  history: HistoricalTask[];
};

// These curated conversations are test support only. Production code must not
// import this module or expose a precomputed walkthrough result.

const financeReframe: TestScenario = {
  id: "finance-reframe",
  title: "The client review that became a data handoff",
  shortTitle: "Finance reframe",
  description:
    "An initially visual client request is reframed as a machine-readable finance delivery.",
  userName: "Maya Chen",
  userRole: "Account lead · Retail analytics",
  messages: [
    {
      id: "M1",
      text: "Can you package June's Acme performance like the last client review?",
      timestamp: "09:12",
    },
    {
      id: "M2",
      text: "Include the important charts and keep it concise.",
      timestamp: "09:14",
    },
    {
      id: "M3",
      text: "Actually, this is for finance ingestion, not a review. No slides — they need the raw rows by Monday.",
      timestamp: "09:19",
    },
  ],
  interpretations: [
    {
      id: "slide-deck",
      title: "Create a client review deck",
      summary:
        "Prepare a concise presentation with June performance charts for Acme.",
      semanticTerms: [
        "client review",
        "review",
        "charts",
        "concise",
        "slides",
        "presentation",
      ],
      features: [
        "purpose:client-review",
        "format:slides",
        "content:charts",
        "style:concise",
        "audience:client",
      ],
    },
    {
      id: "csv-export",
      title: "Export finance-ready CSV data",
      summary:
        "Deliver the underlying June rows in a machine-readable file for finance ingestion.",
      semanticTerms: [
        "finance ingestion",
        "finance",
        "raw rows",
        "rows",
        "csv",
        "monday",
      ],
      features: [
        "purpose:finance-ingestion",
        "format:csv",
        "granularity:raw",
        "audience:finance",
      ],
    },
    {
      id: "dashboard",
      title: "Publish a performance dashboard",
      summary:
        "Create a reusable visual dashboard for exploring Acme's June performance.",
      semanticTerms: [
        "performance",
        "charts",
        "dashboard",
        "visual",
        "client",
        "explore",
      ],
      features: [
        "purpose:monitoring",
        "format:dashboard",
        "content:charts",
        "style:concise",
        "audience:client",
      ],
    },
  ],
  constraintRules: [
    {
      id: "client-review-required",
      phrases: ["client review", "last client review"],
      dimension: "purpose",
      value: "client-review",
      mode: "require",
      strength: 0.8,
      label: "Use the established client-review format",
    },
    {
      id: "charts-required",
      phrases: ["include the important charts", "charts"],
      dimension: "content",
      value: "charts",
      mode: "require",
      strength: 0.65,
      label: "Include important charts",
    },
    {
      id: "concise-required",
      phrases: ["keep it concise", "concise"],
      dimension: "style",
      value: "concise",
      mode: "require",
      strength: 0.45,
      label: "Keep the output concise",
    },
    {
      id: "client-review-forbidden",
      phrases: ["not a review"],
      dimension: "purpose",
      value: "client-review",
      mode: "forbid",
      strength: 1,
      label: "The task is no longer a client review",
    },
    {
      id: "finance-ingestion-required",
      phrases: ["finance ingestion"],
      dimension: "purpose",
      value: "finance-ingestion",
      mode: "require",
      strength: 1,
      label: "Prepare the output for finance ingestion",
    },
    {
      id: "finance-audience-required",
      phrases: ["for finance", "finance ingestion"],
      dimension: "audience",
      value: "finance",
      mode: "require",
      strength: 0.9,
      label: "The audience is finance",
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
    {
      id: "raw-required",
      phrases: ["raw rows"],
      dimension: "granularity",
      value: "raw",
      mode: "require",
      strength: 1,
      label: "Deliver row-level data",
    },
  ],
  history: [
    {
      id: "H1",
      interpretationId: "slide-deck",
      summary: "Quarterly Acme client review with concise performance charts",
      terms: ["acme", "client review", "charts", "concise"],
      accepted: true,
    },
    {
      id: "H2",
      interpretationId: "csv-export",
      summary: "Raw transaction rows for the finance ingestion workflow",
      terms: ["raw rows", "finance ingestion", "finance", "data"],
      accepted: true,
    },
    {
      id: "H3",
      interpretationId: "dashboard",
      summary: "Reusable retail performance dashboard for client exploration",
      terms: ["retail", "performance", "dashboard", "client"],
      accepted: true,
    },
  ],
};

const weeklyAmbiguity: TestScenario = {
  id: "weekly-ambiguity",
  title: "A weekly pulse with two equally plausible formats",
  shortTitle: "Weekly ambiguity",
  description:
    "The language supports both a reusable dashboard and a scheduled leadership report.",
  userName: "Jon Bell",
  userRole: "Operations director · Multi-site retail",
  messages: [
    {
      id: "M1",
      text: "Set up a weekly pulse for retail performance.",
      timestamp: "14:02",
    },
    {
      id: "M2",
      text: "Ops needs to revisit it every Monday and share the highlights with leadership.",
      timestamp: "14:06",
    },
  ],
  interpretations: [
    {
      id: "live-dashboard",
      title: "Build a reusable live dashboard",
      summary:
        "Give operations a persistent view they can return to each Monday.",
      semanticTerms: [
        "weekly pulse",
        "retail performance",
        "revisit",
        "monday",
        "highlights",
        "leadership",
        "operations",
        "dashboard",
      ],
      features: [
        "domain:retail-performance",
        "cadence:weekly",
        "access:reusable",
        "content:highlights",
        "audience:operations",
        "audience:leadership",
      ],
    },
    {
      id: "scheduled-report",
      title: "Send a scheduled weekly report",
      summary:
        "Deliver a concise Monday performance summary for operations and leadership.",
      semanticTerms: [
        "weekly",
        "monday",
        "share the highlights",
        "leadership",
        "report",
      ],
      features: [
        "domain:retail-performance",
        "cadence:weekly",
        "content:highlights",
        "audience:leadership",
      ],
    },
    {
      id: "spreadsheet-tracker",
      title: "Maintain a shared spreadsheet tracker",
      summary:
        "Track weekly retail metrics in a collaborative operations spreadsheet.",
      semanticTerms: [
        "weekly",
        "retail performance",
        "operations",
        "tracker",
        "spreadsheet",
      ],
      features: [
        "domain:retail-performance",
        "cadence:weekly",
        "access:reusable",
        "format:spreadsheet",
        "audience:operations",
      ],
    },
  ],
  constraintRules: [
    {
      id: "retail-domain",
      phrases: ["retail performance"],
      dimension: "domain",
      value: "retail-performance",
      mode: "require",
      strength: 0.5,
      label: "Cover retail performance",
    },
    {
      id: "weekly-cadence",
      phrases: ["weekly", "every monday"],
      dimension: "cadence",
      value: "weekly",
      mode: "require",
      strength: 0.7,
      label: "Support a weekly cadence",
    },
    {
      id: "reusable-access",
      phrases: ["revisit it"],
      dimension: "access",
      value: "reusable",
      mode: "require",
      strength: 0.65,
      label: "Make the output reusable",
    },
    {
      id: "highlights-content",
      phrases: ["share the highlights", "highlights"],
      dimension: "content",
      value: "highlights",
      mode: "require",
      strength: 0.7,
      label: "Surface the key highlights",
    },
    {
      id: "leadership-audience",
      phrases: ["leadership"],
      dimension: "audience",
      value: "leadership",
      mode: "require",
      strength: 0.75,
      label: "Make the result suitable for leadership",
    },
  ],
  history: [
    {
      id: "H1",
      interpretationId: "live-dashboard",
      summary: "Weekly retail pulse dashboard revisited by operations",
      terms: ["weekly pulse", "retail performance", "revisit", "ops"],
      accepted: true,
    },
    {
      id: "H2",
      interpretationId: "scheduled-report",
      summary: "Monday leadership highlights delivered as a weekly summary",
      terms: ["monday", "leadership", "highlights", "weekly"],
      accepted: true,
    },
    {
      id: "H3",
      interpretationId: "spreadsheet-tracker",
      summary: "Retail metrics maintained in a shared spreadsheet tracker",
      terms: ["retail", "metrics", "spreadsheet", "tracker"],
      accepted: true,
    },
  ],
};

export const SCENARIOS = [financeReframe, weeklyAmbiguity] as const;

/** Returns known test data, falling back to the primary ranking regression. */
export function getScenario(id: string): TestScenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}
