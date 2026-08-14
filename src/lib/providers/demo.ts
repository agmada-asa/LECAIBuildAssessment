/**
 * @file Credential-free candidate extraction for arbitrary imported logs.
 *
 * The fallback deliberately proposes three different output forms. It is less
 * capable than a language model and is labelled as such, but it still exercises
 * the same normalization, scoring, confidence, and review pipeline.
 */

import type { ConversationLog } from "@/lib/conversations/schema";
import type { ProviderAnalysis, ProviderConstraint } from "./types";

/** Returns the exact source substring for a grounded case-insensitive pattern. */
function matchPhrase(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[0];
}

/** Creates a constraint only when a user message contains the supplied phrase. */
function constraint(
  id: string,
  phrase: string | undefined,
  dimension: string,
  value: string,
  mode: ProviderConstraint["mode"],
  label: string,
): ProviderConstraint | undefined {
  if (!phrase) return undefined;
  return {
    id,
    phrases: [phrase],
    dimension,
    value,
    mode,
    strength: 1,
    label,
  };
}

/** Generates transparent competing interpretations and grounded format rules. */
export function analyseWithDemo(log: ConversationLog): ProviderAnalysis {
  const combined = log.messages.map((message) => message.text).join("\n");
  const noSlides = matchPhrase(combined, /(?:no|without)\s+(?:slides?|powerpoint|deck)/i);
  const slides = noSlides
    ? undefined
    : matchPhrase(combined, /(?:slides?|powerpoint|presentation|slide deck)/i);

  const constraints = [
    constraint(
      "csv-required",
      matchPhrase(combined, /(?:csv|comma[- ]separated)/i),
      "format",
      "csv",
      "require",
      "Deliver a CSV file",
    ),
    constraint(
      "slides-forbidden",
      noSlides,
      "format",
      "slides",
      "forbid",
      "Do not produce slides",
    ),
    constraint(
      "slides-required",
      slides,
      "format",
      "slides",
      "require",
      "Prepare a presentation",
    ),
    constraint(
      "dashboard-required",
      matchPhrase(combined, /(?:dashboard|live view)/i),
      "format",
      "dashboard",
      "require",
      "Publish a dashboard",
    ),
    constraint(
      "raw-required",
      matchPhrase(combined, /(?:raw rows?|row-level data)/i),
      "granularity",
      "raw",
      "require",
      "Retain row-level data",
    ),
  ].filter((item): item is ProviderConstraint => Boolean(item));

  return {
    interpretations: [
      {
        id: "structured-data",
        title: "Deliver structured data",
        summary: "Turn the requested work into a machine-readable CSV with source-level detail.",
        semanticTerms: ["CSV", "raw rows", "structured data", "spreadsheet", "export"],
        features: ["format:csv", "granularity:raw", "approach:structured"],
      },
      {
        id: "presentation",
        title: "Prepare a visual presentation",
        summary: "Explain the requested work as a concise slide presentation for review.",
        semanticTerms: ["slides", "presentation", "PowerPoint", "review", "charts"],
        features: ["format:slides", "granularity:summarised", "approach:visual"],
      },
      {
        id: "dashboard",
        title: "Publish an interactive dashboard",
        summary: "Make the requested information available as a reusable interactive view.",
        semanticTerms: ["dashboard", "live view", "interactive", "reusable", "monitor"],
        features: ["format:dashboard", "granularity:aggregated", "approach:interactive"],
      },
    ],
    constraints,
    notes:
      "Deterministic fallback: compares structured data, presentation, and dashboard interpretations.",
  };
}
