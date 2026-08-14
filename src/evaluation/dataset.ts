/**
 * @file Labelled evaluation conversations spanning the P1 intent edge cases.
 *
 * Cases use explicit candidate catalogues so the dataset evaluates ranking and
 * abstention independently from whichever generation provider is installed.
 */

import type { ConversationLog } from "@/lib/conversations/schema";
import type { RankingInput } from "@/lib/ranking/types";

export type EvaluationCategory =
  | "clear_intent"
  | "genuine_ambiguity"
  | "late_contradiction"
  | "gradual_reframe"
  | "synonym"
  | "unrelated_replacement"
  | "weak_evidence"
  | "quoted_or_misleading"
  | "negated_instruction";

export type EvaluationCase = {
  id: string;
  category: EvaluationCategory;
  conversation: ConversationLog;
  input: RankingInput;
  expectedWinner: string;
  expectedHumanReview: boolean;
};

const formatInput: RankingInput = {
  interpretations: [
    {
      id: "presentation",
      title: "Prepare a presentation",
      summary: "Create a concise visual slide deck for people to review.",
      semanticTerms: ["slides", "deck", "PowerPoint", "presentation", "charts"],
      features: ["format:slides", "approach:visual"],
    },
    {
      id: "structured-data",
      title: "Deliver structured data",
      summary: "Export machine-readable raw rows as a CSV file.",
      semanticTerms: ["CSV", "raw rows", "comma separated", "data export"],
      features: ["format:csv", "approach:structured"],
    },
    {
      id: "dashboard",
      title: "Publish a dashboard",
      summary: "Build a reusable interactive live view for ongoing monitoring.",
      semanticTerms: ["dashboard", "live view", "interactive", "monitor"],
      features: ["format:dashboard", "approach:interactive"],
    },
  ],
  constraintRules: [
    {
      id: "slides-required",
      phrases: ["slides", "deck", "PowerPoint", "presentation"],
      dimension: "format",
      value: "slides",
      mode: "require",
      strength: 1,
      label: "Prepare a presentation",
    },
    {
      id: "slides-forbidden",
      phrases: ["no slides", "do not make slides", "without slides"],
      dimension: "format",
      value: "slides",
      mode: "forbid",
      strength: 1,
      label: "Do not make slides",
    },
    {
      id: "csv-required",
      phrases: ["CSV", "raw rows", "comma-separated", "machine-readable"],
      dimension: "format",
      value: "csv",
      mode: "require",
      strength: 1,
      label: "Deliver structured data",
    },
    {
      id: "dashboard-required",
      phrases: ["dashboard", "live view"],
      dimension: "format",
      value: "dashboard",
      mode: "require",
      strength: 1,
      label: "Publish a live dashboard",
    },
  ],
  history: [],
};

const topicInput: RankingInput = {
  interpretations: [
    {
      id: "database-runbook",
      title: "Investigate database reliability",
      summary: "Diagnose replication lag and prepare a technical runbook.",
      semanticTerms: ["database", "replication lag", "diagnostic runbook"],
      features: ["topic:database", "format:runbook"],
    },
    {
      id: "onboarding-email",
      title: "Write an onboarding email",
      summary: "Welcome new employees with a friendly email.",
      semanticTerms: ["welcome email", "new employees", "onboarding"],
      features: ["topic:onboarding", "format:email"],
    },
    {
      id: "sales-forecast",
      title: "Prepare a sales forecast",
      summary: "Forecast next-quarter sales for commercial planning.",
      semanticTerms: ["sales forecast", "next quarter", "commercial planning"],
      features: ["topic:sales", "format:forecast"],
    },
  ],
  constraintRules: [
    {
      id: "database-topic",
      phrases: ["replication lag", "database reliability"],
      dimension: "topic",
      value: "database",
      mode: "require",
      strength: 1,
      label: "Investigate database reliability",
    },
    {
      id: "onboarding-topic",
      phrases: ["welcome email", "new employees"],
      dimension: "topic",
      value: "onboarding",
      mode: "require",
      strength: 1,
      label: "Welcome new employees",
    },
    {
      id: "sales-topic",
      phrases: ["sales forecast", "next-quarter sales"],
      dimension: "topic",
      value: "sales",
      mode: "require",
      strength: 1,
      label: "Prepare a sales forecast",
    },
  ],
  history: [],
};

/** Builds a canonical ordered log with stable timestamps. */
function log(id: string, messages: string[]): ConversationLog {
  return {
    conversationId: id,
    userId: "evaluation-user",
    domain: { name: "evaluation" },
    messages: messages.map((text, index) => ({
      id: `M${index + 1}`,
      text,
      timestamp: `2026-08-14T10:${String(index).padStart(2, "0")}:00.000Z`,
    })),
    acceptedOutcomes: [],
  };
}

/** Helper keeps labels visible while avoiding repetitive canonical-log boilerplate. */
function evaluationCase(
  id: string,
  category: EvaluationCategory,
  messages: string[],
  expectedWinner: string,
  expectedHumanReview: boolean,
  input: RankingInput = formatInput,
): EvaluationCase {
  return {
    id,
    category,
    conversation: log(id, messages),
    input,
    expectedWinner,
    expectedHumanReview,
  };
}

export const EVALUATION_DATASET: EvaluationCase[] = [
  evaluationCase("clear-slides", "clear_intent", ["Create slides for Friday's review."], "presentation", false),
  evaluationCase("clear-csv", "clear_intent", ["Export the raw rows as CSV."], "structured-data", false),
  evaluationCase("clear-dashboard", "clear_intent", ["Publish a dashboard for ongoing monitoring."], "dashboard", false),
  evaluationCase("ambiguous-update", "genuine_ambiguity", ["Prepare the June performance update."], "structured-data", true),
  evaluationCase("ambiguous-monday", "genuine_ambiguity", ["Give leadership something useful every Monday."], "dashboard", true),
  evaluationCase("late-slides-to-csv", "late_contradiction", ["Create a slide deck.", "Actually, no slides; send CSV raw rows."], "structured-data", false),
  evaluationCase("late-dashboard-to-slides", "late_contradiction", ["Start with a live view.", "Make it PowerPoint after all."], "presentation", false),
  evaluationCase("late-csv-to-dashboard", "late_contradiction", ["Export CSV.", "Instead, publish a dashboard."], "dashboard", false),
  evaluationCase("gradual-review-to-data", "gradual_reframe", ["Prepare a review.", "Include the figures.", "Finance needs raw rows.", "Send CSV."], "structured-data", false),
  evaluationCase("gradual-visual-to-live", "gradual_reframe", ["Show the key charts.", "People should revisit them.", "Make this a dashboard."], "dashboard", false),
  evaluationCase("synonym-deck", "synonym", ["Prepare a concise deck."], "presentation", false),
  evaluationCase("synonym-powerpoint", "synonym", ["Please make a PowerPoint."], "presentation", false),
  evaluationCase("synonym-presentation", "synonym", ["We need a presentation."], "presentation", false),
  evaluationCase("synonym-comma-separated", "synonym", ["Send a comma-separated export."], "structured-data", false),
  evaluationCase("weak-ack", "weak_evidence", ["Okay, please handle it."], "structured-data", true),
  evaluationCase("weak-context", "weak_evidence", ["Use the usual approach for this one."], "dashboard", true),
  evaluationCase("quoted-old-slides", "quoted_or_misleading", ['The earlier note said “create slides”.', "The current output is raw rows as CSV."], "structured-data", false),
  evaluationCase("quoted-only", "quoted_or_misleading", ['Someone wrote “publish a dashboard”, but that is only a quotation.'], "dashboard", true),
  evaluationCase("negated-slides", "negated_instruction", ["Do not make slides. Send the raw rows."], "structured-data", false),
  evaluationCase("negated-reset", "negated_instruction", ["Do not ignore the previous task.", "Keep the dashboard."], "dashboard", false),
  evaluationCase(
    "replace-database-with-onboarding",
    "unrelated_replacement",
    ["Investigate replication lag.", "Write a welcome email for new employees."],
    "onboarding-email",
    false,
    { ...topicInput, taskBoundaries: [{ messageId: "M2", reason: "The user replaced database work with onboarding." }] },
  ),
  evaluationCase(
    "replace-sales-with-database",
    "unrelated_replacement",
    ["Prepare a sales forecast.", "Instead, investigate database reliability."],
    "database-runbook",
    false,
    { ...topicInput, taskBoundaries: [{ messageId: "M2", reason: "The user replaced sales planning with database work." }] },
  ),
];
