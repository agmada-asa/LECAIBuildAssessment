/** @file Boundary tests for machine-readable review policy and clarification. */

import { describe, expect, it } from "vitest";

import {
  calculateTaskFamilyConfidence,
  strongestCompetingTaskCandidate,
} from "./confidence";
import {
  evaluateHumanReview,
  generateClarificationQuestion,
} from "./engine";
import { influentialAxis } from "./explanations";
import { DEFAULT_WEIGHTS } from "./policy";
import type { RankedInterpretation } from "./types";

function candidate(
  id: string,
  total: number,
  confidence: number,
  features: string[],
  title?: string,
): RankedInterpretation & { features: string[] } {
  return {
    id,
    rank: 1,
    title: title ?? (id === "dashboard" ? "Build a dashboard" : "Send a weekly report"),
    summary: id,
    features,
    semanticTerms: [],
    signals: { semantic: total, constraints: total, history: total },
    total,
    confidence,
    evidence: [],
    explanation: "",
  };
}

describe("evaluateHumanReview", () => {
  it("distinguishes weak total evidence", () => {
    expect(
      evaluateHumanReview([
        candidate("dashboard", 0.51, 0.7, []),
        candidate("report", 0.4, 0.2, []),
      ]),
    ).toMatchObject({ code: "weak_evidence" });
  });

  it("distinguishes low relative leader confidence", () => {
    expect(
      evaluateHumanReview([
        candidate("dashboard", 0.7, 0.54, []),
        candidate("report", 0.5, 0.3, []),
      ]),
    ).toMatchObject({ code: "low_relative_confidence" });
  });

  it("distinguishes a close top-two margin", () => {
    expect(
      evaluateHumanReview([
        candidate("dashboard", 0.8, 0.58, []),
        candidate("report", 0.75, 0.48, []),
      ]),
    ).toMatchObject({ code: "close_candidates" });
  });

  it.each([
    {
      name: "build dashboard variants",
      ranking: [
        candidate("dashboard", 0.804, 0.369, [
          "topic:build-performance",
          "artifact:operational-dashboard",
          "repository:typescript-monorepo",
          "reusability:reusable",
          "metrics:workflow-performance",
          "recommendations:three-experiments",
          "priority:dashboard-primary",
          "purpose:monitor-experiments",
          "context:pull-requests",
          "team:developer-experience",
        ], "Implement an operational build-performance dashboard"),
        candidate("dashboard-brief", 0.784, 0.328, [
          "topic:build-performance",
          "artifact:operational-dashboard",
          "repository:typescript-monorepo",
          "reusability:reusable",
          "metrics:workflow-performance",
          "recommendations:three-experiments",
          "priority:dashboard-primary",
          "purpose:monitor-experiments",
          "context:pull-requests",
          "team:developer-experience",
        ], "Build the dashboard and a separate experiment brief"),
        candidate("dashboard-spec", 0.77, 0.302, [
          "topic:build-performance",
          "artifact:operational-dashboard",
          "repository:typescript-monorepo",
          "reusability:reusable",
          "metrics:workflow-performance",
          "recommendations:three-experiments",
          "priority:dashboard-primary",
          "purpose:monitor-experiments",
          "context:pull-requests",
          "team:developer-experience",
        ], "Produce an implementation-ready dashboard specification"),
      ],
    },
    {
      name: "OAuth threat-model scopes",
      ranking: [
        candidate("oauth", 0.778, 0.362, [
          "task:security-threat-model",
          "topic:oauth-flow",
          "migration:cookie-to-oauth",
          "purpose:architecture-review",
          "coverage:specified-threats",
          "format:presentation",
          "artifact:attack-tree",
          "mitigations:prioritised-table",
          "audience:security-and-identity",
        ], "OAuth flow threat model"),
        candidate("migration", 0.757, 0.32, [
          "task:security-threat-model",
          "topic:oauth-flow",
          "migration:cookie-to-oauth",
          "purpose:architecture-review",
          "coverage:specified-threats",
          "format:presentation",
          "artifact:attack-tree",
          "mitigations:prioritised-table",
          "audience:security-and-identity",
        ], "Authentication migration threat model"),
        candidate("portal", 0.756, 0.318, [
          "task:security-threat-model",
          "topic:oauth-flow",
          "migration:cookie-to-oauth",
          "purpose:architecture-review",
          "coverage:specified-threats",
          "format:presentation",
          "artifact:attack-tree",
          "mitigations:prioritised-table",
          "audience:security-and-identity",
        ], "Customer portal end-to-end threat model"),
      ],
    },
    {
      name: "incident-report framings",
      ranking: [
        candidate("incident-report", 0.777, 0.516, [
          "topic:ios-crash",
          "deliverable:incident-report",
          "audience:on-call",
          "release:version-7-4",
          "platform:ios-17",
          "trigger:session-restore",
          "root-cause:force-unwrap",
          "workstreams:hotfix-and-redesign",
          "tests:regression-list",
          "depth:operational-summary",
        ], "On-call incident handoff report"),
        candidate("remediation-report", 0.688, 0.305, [
          "topic:ios-crash",
          "deliverable:incident-report",
          "audience:on-call",
          "release:version-7-4",
          "platform:ios-17",
          "trigger:session-restore",
          "root-cause:force-unwrap",
          "workstreams:hotfix-and-redesign",
          "tests:regression-list",
          "depth:operational-summary",
        ], "Implementation-oriented remediation report"),
        candidate("post-incident-analysis", 0.597, 0.179, [
          "topic:ios-crash",
          "deliverable:incident-report",
          "audience:on-call",
          "release:version-7-4",
          "platform:ios-17",
          "trigger:session-restore",
          "root-cause:force-unwrap",
          "workstreams:hotfix-and-redesign",
          "tests:regression-list",
          "depth:operational-summary",
        ], "Post-incident analysis with redesign direction"),
      ],
    },
  ])("treats $name as one clear task family", ({ ranking }) => {
    expect(evaluateHumanReview(ranking)).toBeUndefined();
    expect(calculateTaskFamilyConfidence(ranking).confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("does not combine candidates that share only a small amount of context", () => {
    expect(
      evaluateHumanReview([
        candidate("dashboard", 0.72, 0.4, [
          "topic:quarterly-results",
          "format:dashboard",
        ]),
        candidate("report", 0.7, 0.35, [
          "topic:quarterly-results",
          "format:report",
        ]),
        candidate("email", 0.69, 0.25, [
          "topic:quarterly-results",
          "format:email",
        ]),
      ]),
    ).toMatchObject({ code: "low_relative_confidence" });
  });

  it("does not combine candidates that make conflicting canonical decisions", () => {
    expect(
      evaluateHumanReview([
        candidate("dashboard", 0.72, 0.4, [
          "topic:weekly-performance",
          "cadence:weekly",
          "audience:leadership",
          "format:dashboard",
        ], "Publish the weekly performance update as a dashboard"),
        candidate("report", 0.7, 0.35, [
          "topic:weekly-performance",
          "cadence:weekly",
          "audience:leadership",
          "format:report",
        ], "Send the weekly performance update as a report"),
        candidate("email", 0.69, 0.25, [
          "topic:weekly-performance",
          "cadence:weekly",
          "audience:leadership",
          "format:email",
        ], "Email the weekly performance update to leadership"),
      ]),
    ).toMatchObject({ code: "low_relative_confidence" });
  });

  it("does not let an unspecified candidate bridge conflicting task families", () => {
    const result = calculateTaskFamilyConfidence([
      candidate("slides", 0.74, 0.4, [
        "topic:weekly-performance",
        "cadence:weekly",
        "audience:leadership",
        "format:slides",
      ], "Send the weekly performance update as slides"),
      candidate("unspecified", 0.72, 0.35, [
        "topic:weekly-performance",
        "cadence:weekly",
        "audience:leadership",
      ], "Send the weekly performance update"),
      candidate("report", 0.7, 0.25, [
        "topic:weekly-performance",
        "cadence:weekly",
        "audience:leadership",
        "format:report",
      ], "Send the weekly performance update as a report"),
    ]);

    expect(result.confidence).toBeLessThan(0.8);
    expect(result.margin).toBeLessThan(0.6);
  });
});

describe("generateClarificationQuestion", () => {
  it("uses the actual feature disagreement between the top candidates", () => {
    const question = generateClarificationQuestion(
      candidate("dashboard", 0.8, 0.52, ["format:dashboard", "cadence:weekly"]),
      candidate("report", 0.78, 0.48, ["format:report", "cadence:weekly"]),
    );

    expect(question).toBe("Should the format be dashboard or report?");
  });

  it("does not ask users to distinguish paraphrases without a canonical decision", () => {
    const question = generateClarificationQuestion(
      candidate("dashboard", 0.8, 0.52, []),
      candidate("report", 0.78, 0.48, []),
    );

    expect(question).toBeUndefined();
  });

  it("compares with the strongest competing task family rather than a framing variant", () => {
    const winner = candidate("dashboard", 0.8, 0.4, [
      "topic:weekly-performance",
      "cadence:weekly",
      "audience:leadership",
      "format:dashboard",
    ], "Publish the weekly performance dashboard");
    const variant = candidate("dashboard-brief", 0.79, 0.35, [
      "topic:weekly-performance",
      "cadence:weekly",
      "audience:leadership",
      "format:dashboard",
    ], "Publish a weekly performance dashboard brief");
    const report = candidate("report", 0.78, 0.25, [
      "topic:weekly-performance",
      "cadence:weekly",
      "audience:leadership",
      "format:report",
    ], "Send the weekly performance report");

    const competitor = strongestCompetingTaskCandidate([winner, variant, report]);

    expect(competitor?.id).toBe("report");
    expect(generateClarificationQuestion(winner, competitor!)).toBe(
      "Should the format be dashboard or report?",
    );
  });
});

describe("influentialAxis", () => {
  it("defends the winner against the strongest competing family", () => {
    const winner = {
      ...candidate("dashboard", 0.8, 0.4, [
        "topic:weekly-performance",
        "cadence:weekly",
        "audience:leadership",
        "format:dashboard",
      ], "Publish the weekly performance dashboard"),
      signals: { semantic: 0.9, constraints: 0.7, history: 0.5 },
    };
    const variant = {
      ...candidate("dashboard-brief", 0.79, 0.35, [
        "topic:weekly-performance",
        "cadence:weekly",
        "audience:leadership",
        "format:dashboard",
      ], "Publish a weekly performance dashboard brief"),
      signals: { semantic: 0.2, constraints: 0.7, history: 0.5 },
    };
    const report = {
      ...candidate("report", 0.78, 0.25, [
        "topic:weekly-performance",
        "cadence:weekly",
        "audience:leadership",
        "format:report",
      ], "Send the weekly performance report"),
      signals: { semantic: 0.8, constraints: 0.2, history: 0.5 },
    };

    expect(influentialAxis(DEFAULT_WEIGHTS, [winner, variant, report]).key).toBe(
      "constraints",
    );
  });
});
