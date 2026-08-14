/**
 * @file Deterministic semantic, constraint, history, and policy scoring.
 *
 * This module scores one conversation snapshot without comparing it to another
 * run. Cross-run deltas and explanations remain the engine's responsibility.
 */

import { extractConstraints, selectActiveTaskMessages } from "./constraints";
import { embeddingProvider } from "@/lib/embeddings/provider";
import { cosineSimilarity } from "@/lib/embeddings/similarity";
import type { EmbeddingProvider } from "@/lib/embeddings/types";
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
    `avoid ${target}`,
    `never ${target}`,
    `do not ${target}`,
    `dont ${target}`,
  ].some((pattern) => text.includes(pattern));
}

/** A negated canonical term invalidates this message as support for the candidate. */
function explicitlyProhibitsInterpretation(
  message: string,
  interpretation: Interpretation,
): boolean {
  const featureValues = interpretation.features
    .map((feature) => feature.split(":", 2)[1])
    .filter((value) => !["required", "excluded", "none"].includes(value));
  return [...interpretation.semanticTerms, ...featureValues].some((term) =>
    containsNegatedPhrase(message, term.replace(/-/g, " ")),
  );
}

/** Calculates inspectable lexical similarity and source-grounded evidence. */
export const SEMANTIC_RECENCY_DECAY = 0.5;
export const SOFTMAX_TEMPERATURE = 0.17;

/** Calculates embedding cosine similarity with a visible lexical hybrid signal. */
export function semanticScore(
  interpretation: Interpretation,
  messages: ConversationMessage[],
  embeddings: EmbeddingProvider = embeddingProvider,
  recencyDecay = SEMANTIC_RECENCY_DECAY,
): { score: number; evidence: Evidence[] } {
  if (!messages.length) return { score: 0, evidence: [] };
  const candidateText = [
    interpretation.title,
    interpretation.summary,
    ...interpretation.semanticTerms,
  ].join(". ");
  const semanticMessages = messages.map((message) =>
    explicitlyProhibitsInterpretation(message.text, interpretation) ? "" : message.text,
  );
  const [candidateVector, ...messageVectors] = embeddings.embed([
    candidateText,
    ...semanticMessages,
  ]);
  const matches = messages.map((message, index) => {
    const age = messages.length - 1 - index;
    const recency = Math.pow(recencyDecay, age);
    const sourceText = semanticMessages[index];
    const embedding = sourceText
      ? cosineSimilarity(candidateVector, messageVectors[index])
      : 0;
    const lexical = sourceText ? Math.max(
      tokenOverlap(sourceText, candidateText),
      ...interpretation.semanticTerms.map((term) =>
        containsNegatedPhrase(sourceText, term)
          ? 0
          : normaliseText(sourceText).includes(normaliseText(term))
            ? 1
            : tokenOverlap(sourceText, term),
      ),
    ) : 0;
    return { message, recency, embedding, lexical };
  });
  const closest = [...matches].sort(
    (left, right) =>
      right.embedding * right.recency - left.embedding * left.recency,
  )[0];
  const totalRecency = matches.reduce((total, match) => total + match.recency, 0);
  const embeddingAverage = matches.reduce(
    (total, match) => total + match.embedding * match.recency,
    0,
  ) / totalRecency;
  const lexicalBest = Math.max(...matches.map((match) => match.lexical * match.recency));
  const lexicalAverage = matches.reduce(
    (total, match) => total + match.lexical * match.recency,
    0,
  ) / totalRecency;
  const evidence: Evidence[] = [];

  if (closest.embedding >= 0.08) {
    evidence.push({
      messageId: closest.message.id,
      text: `Closest message by ${embeddings.model.name}: “${closest.message.text}”`,
      kind: "semantic",
      sentiment: "supports",
      source: "embedding",
      similarity: round(closest.embedding),
    });
  }
  if (lexicalBest >= 0.45) {
    const lexicalMessage = [...matches].sort(
      (left, right) => right.lexical * right.recency - left.lexical * left.recency,
    )[0];
    evidence.push({
      messageId: lexicalMessage.message.id,
      text: "Inspectable phrase overlap supports this interpretation",
      kind: "semantic",
      sentiment: "supports",
      source: "lexical",
      similarity: round(lexicalMessage.lexical),
    });
  }

  return {
    score: round(
      clamp(
        interpretation.kind === "conversation"
          ? 0.08 + embeddingAverage * 0.68 + lexicalAverage * 0.24
          : 0.08 + embeddingAverage * 0.68 + closest.embedding * closest.recency * 0.16 + lexicalBest * 0.16,
      ),
    ),
    evidence,
  };
}

/** Scores agreement with active constraints and records matches and conflicts. */
export function constraintScore(
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
    const hasOtherValueInDimension = interpretation.features.some((feature) => {
      const [dimension, value] = feature.split(":", 2);
      return (
        dimension === constraint.dimension &&
        !["unspecified", "unknown"].includes(value)
      );
    });
    const consistency =
      constraint.mode === "require"
        ? hasExactFeature
          ? 1
          : hasOtherValueInDimension
            ? 0.12
            : 0.46
        : hasExactFeature
          ? 0
          : hasOtherValueInDimension
            ? 0.94
            : 0.5;

    weightedTotal += consistency * constraint.strength;
    totalStrength += constraint.strength;

    if (consistency >= 0.85) {
      evidence.push({
        messageId: constraint.messageId,
        text: `Source: “${constraint.matchedPhrase}”`,
        kind: "constraints",
        sentiment: "supports",
        source: "constraint",
      });
    } else if (consistency <= 0.15) {
      evidence.push({
        messageId: constraint.messageId,
        text: `Source: “${constraint.matchedPhrase}”`,
        kind: "constraints",
        sentiment: "conflicts",
        source: "constraint",
      });
    }
  });

  return {
    score: round(clamp(weightedTotal / totalStrength)),
    evidence: evidence.slice(-3),
  };
}

/** Scores similarity to previously accepted outcomes for the same candidate. */
export function historicalScore(
  interpretation: Interpretation,
  messages: ConversationMessage[],
  history: HistoricalTask[],
  embeddings: EmbeddingProvider = embeddingProvider,
): { score: number; evidence: Evidence[] } {
  const conversation = messages.map((message) => message.text).join(" ");
  const matchingHistory = history.filter((task) => task.accepted);

  if (!matchingHistory.length) return { score: 0.45, evidence: [] };

  const candidateText = `${interpretation.title}. ${interpretation.summary}. ${interpretation.semanticTerms.join(". ")}`;
  const [candidateVector, conversationVector, ...historyVectors] = embeddings.embed([
    candidateText,
    conversation,
    ...matchingHistory.map((task) => `${task.summary}. ${task.terms.join(". ")}`),
  ]);
  const best = matchingHistory
    .map((task, index) => {
      const candidateSimilarity = cosineSimilarity(candidateVector, historyVectors[index]);
      const conversationSimilarity = cosineSimilarity(conversationVector, historyVectors[index]);
      const explicitMatch = task.interpretationId === interpretation.id ? 0.08 : 0;
      return {
        task,
        similarity: clamp(candidateSimilarity * 0.7 + conversationSimilarity * 0.3 + explicitMatch),
        score: clamp(0.2 + candidateSimilarity * 0.55 + conversationSimilarity * 0.25 + explicitMatch),
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
              source: "history",
              similarity: round(best.similarity),
              provenanceId: best.task.id,
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
export function weightedTotal(scores: SignalScores, weights: SignalWeights): number {
  const normalised = normaliseWeights(weights);
  return round(
    scores.semantic * normalised.semantic +
      scores.constraints * normalised.constraints +
      scores.history * normalised.history,
  );
}

/** Produces relative confidence values; these are not calibrated probabilities. */
export function softmax(values: number[], temperature = SOFTMAX_TEMPERATURE): number[] {
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

/** Applies the conversation-level gate before relative candidate ranking. */
function matchesConversationAssessment(
  interpretation: Interpretation,
  assessment: RankingInput["conversationAssessment"],
): boolean {
  if (!assessment || assessment.kind === "undetermined") return true;
  if (assessment.kind === "actionable-task") {
    return (interpretation.kind ?? "task") === "task";
  }
  if (assessment.kind === "ordinary-conversation") {
    return interpretation.kind === "conversation";
  }
  return interpretation.kind === "insufficient-context";
}

/** Scores and orders one conversation snapshot without comparing prior state. */
export function rankSnapshot(
  input: RankingInput,
  messages: ConversationMessage[],
  weights: SignalWeights,
  embeddings: EmbeddingProvider = embeddingProvider,
): RankingSnapshotResult {
  const { constraints, activeConstraints, reframes } = extractConstraints(
    messages,
    input.constraintRules,
    input.taskBoundaries,
  );
  const activeTaskMessages = selectActiveTaskMessages(messages, input.taskBoundaries);
  const provisional = input.interpretations.map((interpretation) => {
    // Ordinary conversations are characterized as a whole. Task ranking keeps
    // recency so a genuine later instruction can supersede earlier work.
    const semantic = semanticScore(
      interpretation,
      activeTaskMessages,
      embeddings,
      interpretation.kind === "conversation" ? 1 : SEMANTIC_RECENCY_DECAY,
    );
    const constraint = constraintScore(interpretation, constraints);
    const historical = historicalScore(
      interpretation,
      activeTaskMessages,
      input.history,
      embeddings,
    );
    const signals: SignalScores = {
      semantic: semantic.score,
      constraints: constraint.score,
      history: historical.score,
    };

    return {
      id: interpretation.id,
      kind: interpretation.kind,
      rank: 0,
      title: interpretation.title,
      summary: interpretation.summary,
      features: interpretation.features,
      semanticTerms: interpretation.semanticTerms,
      signals,
      total: weightedTotal(signals, weights),
      confidence: 0,
      valid:
        matchesConversationAssessment(interpretation, input.conversationAssessment) &&
        (semantic.evidence.some(
          (evidence) =>
            evidence.source === "lexical" || (evidence.similarity ?? 0) >= 0.14,
        ) ||
          constraint.evidence.some((evidence) => evidence.sentiment === "supports") ||
          historical.evidence.length > 0),
      evidence: [...constraint.evidence, ...semantic.evidence, ...historical.evidence],
      explanation: "",
    } satisfies RankedInterpretation;
  });

  provisional.sort(
    (left, right) => Number(right.valid) - Number(left.valid) || right.total - left.total,
  );
  const validItems = provisional.filter((item) => item.valid);
  const confidences = validItems.length
    ? softmax(validItems.map((item) => item.total))
    : [];
  provisional.forEach((item, index) => {
    item.rank = index + 1;
    const validIndex = validItems.indexOf(item);
    item.confidence = validIndex >= 0 ? confidences[validIndex] : 0;
  });

  return { ranking: provisional, constraints, activeConstraints, reframes };
}
