/**
 * @file Deterministic semantic, constraint, history, and policy scoring.
 *
 * This module scores one conversation snapshot without comparing it to another
 * run. Cross-run deltas and explanations remain the engine's responsibility.
 */

import { extractConstraints, selectActiveTaskMessages } from "./constraints";
import { normaliseText, tokenOverlap } from "./text";
import type {
  ConversationMessage,
  Evidence,
  ExtractedConstraint,
  HistoricalTask,
  Interpretation,
  RankedInterpretation,
  RankingInput,
  ReframeEvent,
  SignalScores,
  SignalWeights,
} from "./types";

/** Constrains a numeric score to the engine's normalised interval. */
function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/** Rounds stored scores to three decimals so output is stable and inspectable. */
export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Detects explicit local negation so a forbidden phrase is not semantic support. */
function containsNegatedPhrase(message: string, phrase: string): boolean {
  const text = normaliseText(message);
  const target = normaliseText(phrase);
  return [
    `not a ${target}`,
    `not an ${target}`,
    `not ${target}`,
    `no ${target}`,
    `without ${target}`,
  ].some((pattern) => text.includes(pattern));
}

/** Calculates inspectable lexical similarity and source-grounded evidence. */
function semanticScore(
  interpretation: Interpretation,
  messages: ConversationMessage[],
): { score: number; evidence: Evidence[] } {
  const evidence: Evidence[] = [];
  const weightedMatches: number[] = [];

  interpretation.semanticTerms.forEach((term) => {
    let bestMatch = 0;
    let bestMessage: ConversationMessage | undefined;

    messages.forEach((message, index) => {
      const age = messages.length - 1 - index;
      const recency = Math.pow(0.76, age);
      const normalisedMessage = normaliseText(message.text);
      const normalisedTerm = normaliseText(term);
      const match = normalisedMessage.includes(normalisedTerm)
        ? containsNegatedPhrase(message.text, term)
          ? 0
          : 1
        : tokenOverlap(message.text, term) * 0.62;

      if (match * recency > bestMatch) {
        bestMatch = match * recency;
        bestMessage = message;
      }
    });

    weightedMatches.push(bestMatch);
    if (bestMatch >= 0.45 && bestMessage) {
      evidence.push({
        messageId: bestMessage.id,
        text: `“${term}” aligns with this interpretation`,
        kind: "semantic",
        sentiment: "supports",
      });
    }
  });

  const strongest = weightedMatches.sort((a, b) => b - a).slice(0, 4);
  const coverage =
    strongest.reduce((total, value) => total + value, 0) /
    Math.max(4, strongest.length);
  const descriptionOverlap = tokenOverlap(
    messages.map((message) => message.text).join(" "),
    `${interpretation.title} ${interpretation.summary}`,
  );

  return {
    score: round(clamp(0.12 + coverage * 0.76 + descriptionOverlap * 0.2)),
    evidence: evidence.slice(0, 2),
  };
}

/** Scores agreement with active constraints and records matches and conflicts. */
function constraintScore(
  interpretation: Interpretation,
  constraints: ExtractedConstraint[],
): { score: number; evidence: Evidence[] } {
  const active = constraints.filter(
    (constraint) => !constraint.superseded && constraint.strength > 0,
  );
  if (!active.length) return { score: 0.5, evidence: [] };

  let weightedTotal = 0;
  let totalStrength = 0;
  const evidence: Evidence[] = [];

  active.forEach((constraint) => {
    const exactFeature = `${constraint.dimension}:${constraint.value}`;
    const hasExactFeature = interpretation.features.includes(exactFeature);
    const hasOtherValueInDimension = interpretation.features.some((feature) =>
      feature.startsWith(`${constraint.dimension}:`),
    );
    const consistency =
      constraint.mode === "require"
        ? hasExactFeature
          ? 1
          : hasOtherValueInDimension
            ? 0.12
            : 0.46
        : hasExactFeature
          ? 0
          : 0.94;

    weightedTotal += consistency * constraint.strength;
    totalStrength += constraint.strength;

    if (consistency >= 0.85) {
      evidence.push({
        messageId: constraint.messageId,
        text: constraint.label,
        kind: "constraints",
        sentiment: "supports",
      });
    } else if (consistency <= 0.15) {
      evidence.push({
        messageId: constraint.messageId,
        text: constraint.label,
        kind: "constraints",
        sentiment: "conflicts",
      });
    }
  });

  return {
    score: round(clamp(weightedTotal / totalStrength)),
    evidence: evidence.slice(-3),
  };
}

/** Scores similarity to previously accepted outcomes for the same candidate. */
function historicalScore(
  interpretation: Interpretation,
  messages: ConversationMessage[],
  history: HistoricalTask[],
): { score: number; evidence: Evidence[] } {
  const conversation = messages.map((message) => message.text).join(" ");
  const matchingHistory = history.filter(
    (task) => task.accepted && task.interpretationId === interpretation.id,
  );

  if (!matchingHistory.length) return { score: 0.45, evidence: [] };

  const best = matchingHistory
    .map((task) => {
      const phraseCoverage =
        task.terms.filter((term) => normaliseText(conversation).includes(normaliseText(term)))
          .length / Math.max(task.terms.length, 1);
      return {
        task,
        score: clamp(0.2 + phraseCoverage * 0.62 + tokenOverlap(conversation, task.summary) * 0.24),
      };
    })
    .sort((left, right) => right.score - left.score)[0];

  return {
    score: round(best.score),
    evidence:
      best.score >= 0.42
        ? [
            {
              text: `Similar accepted task: “${best.task.summary}”`,
              kind: "history",
              sentiment: "supports",
            },
          ]
        : [],
  };
}

/** Converts arbitrary UI weights into a non-negative, unit-sum policy. */
export function normaliseWeights(weights: SignalWeights): SignalWeights {
  const nonNegative = {
    semantic: Math.max(weights.semantic, 0),
    constraints: Math.max(weights.constraints, 0),
    history: Math.max(weights.history, 0),
  };
  const sum = nonNegative.semantic + nonNegative.constraints + nonNegative.history;

  if (sum === 0) return { semantic: 1 / 3, constraints: 1 / 3, history: 1 / 3 };
  return {
    semantic: nonNegative.semantic / sum,
    constraints: nonNegative.constraints / sum,
    history: nonNegative.history / sum,
  };
}

/** Combines independent axes using the normalised policy weights. */
function weightedTotal(scores: SignalScores, weights: SignalWeights): number {
  const normalised = normaliseWeights(weights);
  return round(
    scores.semantic * normalised.semantic +
      scores.constraints * normalised.constraints +
      scores.history * normalised.history,
  );
}

/** Produces relative confidence values; these are not calibrated probabilities. */
function softmax(values: number[], temperature = 0.17): number[] {
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => Math.exp((value - maximum) / temperature));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => round(value / total));
}

export type RankingSnapshotResult = {
  ranking: RankedInterpretation[];
  constraints: ExtractedConstraint[];
  activeConstraints: ExtractedConstraint[];
  reframes: ReframeEvent[];
};

/** Scores and orders one conversation snapshot without comparing prior state. */
export function rankSnapshot(
  input: RankingInput,
  messages: ConversationMessage[],
  weights: SignalWeights,
): RankingSnapshotResult {
  const { constraints, activeConstraints, reframes } = extractConstraints(
    messages,
    input.constraintRules,
    input.taskBoundaries,
  );
  const activeTaskMessages = selectActiveTaskMessages(messages, input.taskBoundaries);
  const provisional = input.interpretations.map((interpretation) => {
    const semantic = semanticScore(interpretation, activeTaskMessages);
    const constraint = constraintScore(interpretation, constraints);
    const historical = historicalScore(interpretation, activeTaskMessages, input.history);
    const signals: SignalScores = {
      semantic: semantic.score,
      constraints: constraint.score,
      history: historical.score,
    };

    return {
      id: interpretation.id,
      rank: 0,
      title: interpretation.title,
      summary: interpretation.summary,
      signals,
      total: weightedTotal(signals, weights),
      confidence: 0,
      evidence: [...constraint.evidence, ...semantic.evidence, ...historical.evidence],
      explanation: "",
    } satisfies RankedInterpretation;
  });

  provisional.sort((left, right) => right.total - left.total);
  const confidences = softmax(provisional.map((item) => item.total));
  provisional.forEach((item, index) => {
    item.rank = index + 1;
    item.confidence = confidences[index];
  });

  return { ranking: provisional, constraints, activeConstraints, reframes };
}
