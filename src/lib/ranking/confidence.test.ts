/** @file Boundary tests for machine-readable review policy and clarification. */

import { describe, expect, it } from "vitest";

import { calculateTaskFamilyConfidence } from "./confidence";
import {
  evaluateHumanReview,
  generateClarificationQuestion,
} from "./engine";
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
          "artifact:dashboard-plus-brief",
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
          "artifact:dashboard-specification",
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
          "topic:authentication-migration",
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
          "topic:customer-portal",
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
          "deliverable:remediation-plan",
          "audience:on-call",
          "release:version-7-4",
          "platform:ios-17",
          "trigger:session-restore",
          "root-cause:force-unwrap",
          "workstreams:hotfix-and-redesign",
          "tests:release-gates",
          "depth:implementation-oriented",
        ], "Implementation-oriented remediation report"),
        candidate("post-incident-analysis", 0.597, 0.179, [
          "topic:ios-crash",
          "deliverable:post-incident-analysis",
          "audience:on-call",
          "release:version-7-4",
          "platform:ios-17",
          "trigger:session-restore",
          "root-cause:force-unwrap",
          "workstreams:containment-and-prevention",
          "tests:hotfix-and-redesign",
          "depth:root-cause-analysis",
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
});
