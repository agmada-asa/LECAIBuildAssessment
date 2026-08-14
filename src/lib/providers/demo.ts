/**
 * @file Credential-free candidate extraction for arbitrary imported logs.
 *
 * The fallback deliberately proposes three different output forms. It is less
 * capable than a language model and is labelled as such, but it still exercises
 * the same normalization, scoring, confidence, and review pipeline.
 */

import type { ConversationLog } from "@/lib/conversations/schema";
import type { ProviderAnalysis, ProviderConstraint } from "./types";

/** Returns each distinct source substring so reversals remain ordered downstream. */
function matchPhrases(log: ConversationLog, pattern: RegExp): string[] {
  return [
    ...new Set(
      log.messages
        .map((message) => message.text.match(pattern)?.[0])
        .filter((phrase): phrase is string => Boolean(phrase)),
    ),
  ];
}

/** Creates a constraint only when a user message contains the supplied phrase. */
function constraint(
  id: string,
  phrases: string[],
  dimension: string,
  value: string,
  mode: ProviderConstraint["mode"],
  label: string,
): ProviderConstraint | undefined {
  if (!phrases.length) return undefined;
  return {
    id,
    phrases,
    dimension,
    value,
    mode,
    strength: 1,
    label,
  };
}

/** Generates transparent competing interpretations and grounded format rules. */
export function analyseWithDemo(log: ConversationLog): ProviderAnalysis {
  const constraints = [
    constraint(
      "csv-required",
      matchPhrases(log, /(?:csv|comma[- ]separated|spreadsheet export|machine-readable (?:file|export))/i),
      "format",
      "csv",
      "require",
      "Deliver a CSV file",
    ),
    constraint(
      "slides-forbidden",
      matchPhrases(
        log,
        /(?:no|without|not using|do not (?:make|use))\s+(?:slides?|powerpoint|deck|presentation)/i,
      ),
      "format",
      "slides",
      "forbid",
      "Do not produce slides",
    ),
    constraint(
      "slides-required",
      matchPhrases(log, /(?:powerpoint(?: after all)?|slide deck|presentation|slides?)/i),
      "format",
      "slides",
      "require",
      "Prepare slides or PowerPoint",
    ),
    constraint(
      "dashboard-required",
      matchPhrases(log, /(?:dashboard|live view)/i),
      "format",
      "dashboard",
      "require",
      "Publish a dashboard",
    ),
    constraint(
      "raw-required",
      matchPhrases(log, /(?:raw rows?|row-level data)/i),
      "granularity",
      "raw",
      "require",
      "Retain row-level data",
    ),
    constraint(
      "client-review-required",
      matchPhrases(log, /(?:client review|review deck)/i),
      "purpose",
      "client-review",
      "require",
      "Prepare the work for client review",
    ),
    constraint(
      "client-review-forbidden",
      matchPhrases(log, /(?:not|no longer)\s+(?:a\s+)?(?:client\s+)?review/i),
      "purpose",
      "client-review",
      "forbid",
      "The work is not for client review",
    ),
    constraint(
      "finance-ingestion-required",
      matchPhrases(log, /(?:finance ingestion|finance data handoff|for finance)/i),
      "purpose",
      "finance-ingestion",
      "require",
      "Prepare the work for finance ingestion",
    ),
  ].filter((item): item is ProviderConstraint => Boolean(item));

  return {
    interpretations: [
      {
        id: "structured-data",
        title: "Deliver structured data",
        summary: "Turn the requested work into a machine-readable CSV with source-level detail.",
        semanticTerms: ["CSV", "raw rows", "structured data", "spreadsheet", "export"],
        features: [
          "format:csv",
          "granularity:raw",
          "approach:structured",
          "purpose:finance-ingestion",
        ],
      },
      {
        id: "presentation",
        title: "Prepare a visual presentation",
        summary: "Explain the requested work as a concise slide presentation for review.",
        semanticTerms: ["slides", "presentation", "PowerPoint", "review", "charts"],
        features: [
          "format:slides",
          "granularity:summarised",
          "approach:visual",
          "purpose:client-review",
        ],
      },
      {
        id: "dashboard",
        title: "Publish an interactive dashboard",
        summary: "Make the requested information available as a reusable interactive view.",
        semanticTerms: ["dashboard", "live view", "interactive", "reusable", "monitor"],
        features: [
          "format:dashboard",
          "granularity:aggregated",
          "approach:interactive",
          "purpose:monitoring",
        ],
      },
    ],
    constraints,
    taskBoundaries: [],
    notes:
      "Deterministic fallback: compares structured data, presentation, and dashboard interpretations.",
  };
}
