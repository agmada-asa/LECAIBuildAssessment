/**
 * @file Ordered constraint extraction and whole-task boundary handling.
 *
 * Matching retains source provenance, ignores quoted or reported instructions,
 * and keeps superseded constraints in the audit trail.
 */

import type {
  ConstraintRule,
  ConversationMessage,
  ExtractedConstraint,
  ReframeEvent,
  TaskBoundary,
} from "./types";
import { normaliseText } from "./text";

type GroundedPhrase = { text: string; index: number };
type MatchedConstraint = ExtractedConstraint & { matchIndex: number };

/** Escapes provider phrases before compiling a boundary-aware matcher. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns whether a match is enclosed by common quotation marks. */
function isQuoted(text: string, start: number, end: number): boolean {
  const quotedRanges = [
    /"[^"]*"/g,
    /“[^”]*”/g,
    /‘[^’]*’/g,
    /`[^`]*`/g,
  ];

  return quotedRanges.some((pattern) =>
    [...text.matchAll(pattern)].some(
      (match) =>
        match.index !== undefined &&
        match.index <= start &&
        match.index + match[0].length >= end,
    ),
  );
}

/** Detects attribution or repetition language immediately before a phrase. */
function isReportedInstruction(text: string, index: number): boolean {
  const context = normaliseText(text.slice(Math.max(0, index - 90), index));
  return /(?:old (?:brief|note|request) says|(?:the )?(?:policy|brief|note|message|request) says|(?:you|they|we|i) (?:previously |earlier )?(?:said|wrote|asked|mentioned)|(?:quoting|quoted|repeating|repeated) (?:for|from)?|according to)\s*$/.test(
    context,
  );
}

/** Detects negation immediately before an instruction or reset cue. */
function isExplicitlyNegated(text: string, index: number): boolean {
  const context = normaliseText(text.slice(Math.max(0, index - 45), index));
  return /(?:no|not(?: a| an)?|without|avoid|avoiding|never|dont|do not|stop|shouldnt|should not|mustnt|must not)(?:\s+[a-z0-9-]+){0,2}\s*$/.test(
    context,
  );
}

/** Returns the earliest usable source substring for a configured rule. */
function findBestPhrase(text: string, rule: ConstraintRule): GroundedPhrase | undefined {
  return rule.phrases
    .flatMap((phrase) => {
      const source = escapeRegExp(phrase.trim()).replace(/\s+/g, "\\s+");
      const matches = text.matchAll(
        new RegExp(`(?<![a-z0-9])${source}(?![a-z0-9])`, "gi"),
      );
      return [...matches].flatMap((match) => {
        if (!match[0] || match.index === undefined) return [];
        const end = match.index + match[0].length;
        if (
          isQuoted(text, match.index, end) ||
          isReportedInstruction(text, match.index) ||
          (rule.mode === "require" && isExplicitlyNegated(text, match.index))
        ) {
          return [];
        }
        return [{ text: match[0], index: match.index }];
      });
    })
    .sort((left, right) => left.index - right.index)[0];
}

const taskSwitchPattern =
  /(?:forget|ignore|disregard|drop)\s+(?:the\s+)?(?:previous|earlier|old|above)\s+(?:task|request|brief)|(?:this\s+is\s+(?:a\s+)?|a\s+)?new\s+task|switch\s+(?:to\s+)?(?:another|a\s+different)\s+task|start\s+over/gi;

/** Identifies an actionable cue that discards the earlier task as a whole. */
function isCompleteTaskSwitch(text: string): boolean {
  return [...text.matchAll(taskSwitchPattern)].some((match) => {
    if (!match[0] || match.index === undefined) return false;
    const end = match.index + match[0].length;
    return !(
      isQuoted(text, match.index, end) ||
      isReportedInstruction(text, match.index) ||
      isExplicitlyNegated(text, match.index)
    );
  });
}

/** Returns only messages belonging to the current task for intent-based scoring. */
export function selectActiveTaskMessages(
  messages: ConversationMessage[],
  taskBoundaries: TaskBoundary[] = [],
): ConversationMessage[] {
  const boundaryMessageIds = new Set(taskBoundaries.map((boundary) => boundary.messageId));
  let activeTaskStart = 0;

  messages.forEach((message, index) => {
    if (boundaryMessageIds.has(message.id) || isCompleteTaskSwitch(message.text)) {
      activeTaskStart = index;
    }
  });

  return messages.slice(activeTaskStart);
}

/** Removes extraction-only ordering data before a constraint enters the audit model. */
function canonicalConstraint(constraint: MatchedConstraint): ExtractedConstraint {
  return {
    id: constraint.id,
    phrases: constraint.phrases,
    dimension: constraint.dimension,
    value: constraint.value,
    mode: constraint.mode,
    strength: constraint.strength,
    label: constraint.label,
    messageId: constraint.messageId,
    messageIndex: constraint.messageIndex,
    matchedPhrase: constraint.matchedPhrase,
    superseded: constraint.superseded,
  };
}

/** Selects one inspectable active value for each constraint dimension. */
function selectActiveConstraints(constraints: ExtractedConstraint[]): ExtractedConstraint[] {
  const byDimension = new Map<string, ExtractedConstraint>();
  constraints
    .filter((constraint) => !constraint.superseded)
    .forEach((constraint) => {
      const existing = byDimension.get(constraint.dimension);
      if (
        !existing ||
        constraint.messageIndex > existing.messageIndex ||
        (constraint.messageIndex === existing.messageIndex &&
          (constraint.mode === "require" || existing.mode !== "require"))
      ) {
        byDimension.set(constraint.dimension, constraint);
      }
    });
  return [...byDimension.values()].sort(
    (left, right) => left.messageIndex - right.messageIndex,
  );
}

/** Extracts ordered constraints and supersedes prior values or whole-task state. */
export function extractConstraints(
  messages: ConversationMessage[],
  rules: ConstraintRule[],
  taskBoundaries: TaskBoundary[] = [],
): {
  constraints: ExtractedConstraint[];
  activeConstraints: ExtractedConstraint[];
  reframes: ReframeEvent[];
} {
  const constraints: ExtractedConstraint[] = [];
  const reframes: ReframeEvent[] = [];
  const taskBoundaryReasons = new Map(
    taskBoundaries.map((boundary) => [boundary.messageId, boundary.reason]),
  );

  messages.forEach((message, messageIndex) => {
    const extracted: MatchedConstraint[] = rules
      .flatMap((rule) => {
        const match = findBestPhrase(message.text, rule);
        return match
          ? [
              {
                ...rule,
                messageId: message.id,
                messageIndex,
                matchedPhrase: match.text,
                superseded: false,
                matchIndex: match.index,
              },
            ]
          : [];
      })
      .sort((left, right) => left.matchIndex - right.matchIndex);

    const taskBoundaryReason = taskBoundaryReasons.get(message.id);
    const isTaskSwitch = taskBoundaryReasons.has(message.id) || isCompleteTaskSwitch(message.text);

    if (isTaskSwitch && !extracted.length) {
      constraints
        .filter((constraint) => !constraint.superseded)
        .forEach((constraint) => {
          constraint.superseded = true;
        });
      return;
    }

    if (!extracted.length) return;

    if (isTaskSwitch) {
      const topicReplacement =
        [...extracted]
          .reverse()
          .find(
            (constraint) =>
              constraint.mode === "require" &&
              (constraint.dimension === "topic" || constraint.dimension === "task"),
          ) ??
        [...extracted].reverse().find((constraint) => constraint.mode === "require") ??
        extracted.at(-1)!;
      constraints
        .filter((constraint) => !constraint.superseded)
        .forEach((previousConstraint) => {
          const replacement =
            [...extracted]
              .reverse()
              .find(
                (constraint) =>
                  constraint.mode === "require" &&
                  constraint.dimension === previousConstraint.dimension,
              ) ?? topicReplacement;
          previousConstraint.superseded = true;
          reframes.push({
            messageId: message.id,
            kind: "task-switch",
            reason: taskBoundaryReason,
            summary: taskBoundaryReason
              ? `${message.id} replaced “${previousConstraint.label}” with “${replacement.label}”: ${taskBoundaryReason}`
              : `${message.id} replaced “${previousConstraint.label}” with “${replacement.label}” as part of a complete task switch.`,
            previousConstraint,
            replacementConstraint: canonicalConstraint(replacement),
          });
        });
    } else {
      const dimensions = new Map<string, typeof extracted>();
      extracted.forEach((constraint) => {
        dimensions.set(constraint.dimension, [
          ...(dimensions.get(constraint.dimension) ?? []),
          constraint,
        ]);
      });

      dimensions.forEach((newConstraints, dimension) => {
        const replacement =
          [...newConstraints].reverse().find((constraint) => constraint.mode === "require") ??
          newConstraints.at(-1)!;

        constraints
          .filter(
            (constraint) =>
              !constraint.superseded && constraint.dimension === dimension,
          )
          .forEach((previousConstraint) => {
            const isRestatement =
              previousConstraint.value === replacement.value &&
              previousConstraint.mode === replacement.mode;
            const changesActiveValue =
              replacement.mode === "require" ||
              previousConstraint.value === replacement.value;
            if (!isRestatement && !changesActiveValue) return;

            previousConstraint.superseded = true;
            if (!isRestatement) {
              reframes.push({
                messageId: message.id,
                kind: "constraint-change",
                summary: `${message.id} changed ${dimension} from “${previousConstraint.label}” to “${replacement.label}”.`,
                previousConstraint,
                replacementConstraint: canonicalConstraint(replacement),
              });
            }
          });
      });
    }

    constraints.push(...extracted.map(canonicalConstraint));
  });

  return {
    constraints,
    activeConstraints: selectActiveConstraints(constraints),
    reframes,
  };
}
