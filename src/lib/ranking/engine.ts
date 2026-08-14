/**
 * @file Deterministic scoring, ranking, explanation, and abstention engine.
 *
 * Each public run recomputes current and previous turns from explicit inputs.
 * This keeps rank movement reproducible and prevents hidden provider memory
 * from becoming an undocumented scoring signal.
 */

import type {
  ConstraintRule,
  ConversationMessage,
  Evidence,
  ExtractedConstraint,
  HistoricalTask,
  Interpretation,
  RankedInterpretation,
  RankingResult,
  ReframeEvent,
  Scenario,
  SignalKey,
  SignalScores,
  SignalWeights,
} from "./types";

const SIGNAL_LABELS: Record<SignalKey, string> = {
  semantic: "semantic similarity",
  constraints: "constraint consistency",
  history: "historical pattern matching",
};

/** Constrains a numeric score to the engine's normalised interval. */
function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/** Rounds stored scores to three decimals so output is stable and inspectable. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Canonicalises user text for deterministic phrase and token comparisons. */
function normaliseText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns meaningful lowercase tokens while discarding two-character noise. */
function tokenise(value: string): Set<string> {
  return new Set(
    normaliseText(value)
      .split(" ")
      .filter((token) => token.length > 2),
  );
}

/** Measures overlap against the smaller token set so short phrases can match. */
function tokenOverlap(left: string, right: string): number {
  const leftTokens = tokenise(left);
  const rightTokens = tokenise(right);
  if (!leftTokens.size || !rightTokens.size) return 0;

  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });

  return intersection / Math.min(leftTokens.size, rightTokens.size);
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

/**
 * Lightweight, deterministic semantic similarity for the zero-setup demo.
 * The optional CLI provider can replace candidate extraction, while this score
 * remains transparent enough for reviewers to reproduce by inspection.
 */
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

      let match = 0;
      if (normalisedMessage.includes(normalisedTerm)) {
        match = containsNegatedPhrase(message.text, term) ? 0 : 1;
      } else {
        match = tokenOverlap(message.text, term) * 0.62;
      }

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

/** Returns the first configured phrase grounded in the supplied message text. */
function findBestPhrase(text: string, rule: ConstraintRule): string | undefined {
  const normalised = normaliseText(text);
  return rule.phrases.find((phrase) => normalised.includes(normaliseText(phrase)));
}

/** Extracts constraints and marks an earlier opposite constraint as superseded. */
export function extractConstraints(
  messages: ConversationMessage[],
  rules: ConstraintRule[],
): { constraints: ExtractedConstraint[]; reframes: ReframeEvent[] } {
  const constraints: ExtractedConstraint[] = [];
  const reframes: ReframeEvent[] = [];

  messages.forEach((message, messageIndex) => {
    rules.forEach((rule) => {
      const matchedPhrase = findBestPhrase(message.text, rule);
      if (!matchedPhrase) return;

      const extracted: ExtractedConstraint = {
        ...rule,
        messageId: message.id,
        messageIndex,
        matchedPhrase,
        superseded: false,
      };

      const opposite = [...constraints]
        .reverse()
        .find(
          (item) =>
            !item.superseded &&
            item.dimension === rule.dimension &&
            item.value === rule.value &&
            item.mode !== rule.mode,
        );

      if (opposite) {
        opposite.superseded = true;
        reframes.push({
          messageId: message.id,
          summary: `${message.id} reversed “${opposite.label.toLowerCase()}”.`,
          previousConstraint: opposite,
          replacementConstraint: extracted,
        });
      }

      constraints.push(extracted);
    });
  });

  return { constraints, reframes };
}

/** Scores agreement with active constraints and records matches and conflicts. */
function constraintScore(
  interpretation: Interpretation,
  constraints: ExtractedConstraint[],
): { score: number; evidence: Evidence[] } {
  const active = constraints.filter((constraint) => !constraint.superseded);
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

    let consistency: number;
    if (constraint.mode === "require") {
      consistency = hasExactFeature ? 1 : hasOtherValueInDimension ? 0.12 : 0.46;
    } else {
      consistency = hasExactFeature ? 0 : 0.94;
    }

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

  const scored = matchingHistory
    .map((task) => {
      const phraseCoverage =
        task.terms.filter((term) => normaliseText(conversation).includes(normaliseText(term)))
          .length / Math.max(task.terms.length, 1);
      const overlap = tokenOverlap(conversation, task.summary);
      return {
        task,
        score: clamp(0.2 + phraseCoverage * 0.62 + overlap * 0.24),
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
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
function normaliseWeights(weights: SignalWeights): SignalWeights {
  const nonNegative = {
    semantic: Math.max(weights.semantic, 0),
    constraints: Math.max(weights.constraints, 0),
    history: Math.max(weights.history, 0),
  };
  const sum = nonNegative.semantic + nonNegative.constraints + nonNegative.history;

  // Equal influence is the least surprising fallback for an invalid zero policy.
  if (sum === 0) {
    return { semantic: 1 / 3, constraints: 1 / 3, history: 1 / 3 };
  }

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
  const exponentials = values.map((value) =>
    Math.exp((value - maximum) / temperature),
  );
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => round(value / total));
}

/** Builds an auditable explanation exclusively from computed ranking data. */
function createExplanation(
  ranking: RankedInterpretation[],
  previousRanking: RankedInterpretation[] | undefined,
  weights: SignalWeights,
  reframes: ReframeEvent[],
  uncertain: boolean,
  uncertaintyReason?: string,
): string {
  const winner = ranking[0];
  const previousWinner = previousRanking?.[0];
  const effectiveWeights = normaliseWeights(weights);
  const strongestWeight = (
    Object.entries(effectiveWeights) as [SignalKey, number][]
  ).sort((left, right) => right[1] - left[1])[0];

  const statements: string[] = [];
  if (previousWinner && previousWinner.id !== winner.id) {
    statements.push(
      `${winner.title} moved to rank one, replacing ${previousWinner.title.toLowerCase()}.`,
    );
  } else {
    statements.push(`${winner.title} is currently the strongest interpretation.`);
  }

  statements.push(
    `${SIGNAL_LABELS[strongestWeight[0]]} carried the most weight (${Math.round(
      strongestWeight[1] * 100,
    )}%).`,
  );

  if (reframes.length) {
    statements.push(
      `The latest reframe superseded an earlier constraint, so the newer explicit instruction took precedence.`,
    );
  }

  if (uncertain && uncertaintyReason) {
    statements.push(`Human review is recommended: ${uncertaintyReason}`);
  } else {
    const strongestSignal = (Object.entries(winner.signals) as [SignalKey, number][]).sort(
      (left, right) => right[1] - left[1],
    )[0];
    statements.push(
      `Its strongest evidence is ${SIGNAL_LABELS[strongestSignal[0]]} (${Math.round(
        strongestSignal[1] * 100,
      )}%).`,
    );
  }

  return statements.join(" ");
}

/** Scores and orders one conversation snapshot without comparing prior state. */
function rankOnce(
  scenario: Scenario,
  messages: ConversationMessage[],
  weights: SignalWeights,
): {
  ranking: RankedInterpretation[];
  constraints: ExtractedConstraint[];
  reframes: ReframeEvent[];
} {
  const { constraints, reframes } = extractConstraints(
    messages,
    scenario.constraintRules,
  );

  const provisional = scenario.interpretations.map((interpretation) => {
    const semantic = semanticScore(interpretation, messages);
    const constraint = constraintScore(interpretation, constraints);
    const historical = historicalScore(interpretation, messages, scenario.history);
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
      evidence: [
        ...constraint.evidence,
        ...semantic.evidence,
        ...historical.evidence,
      ],
    } satisfies RankedInterpretation;
  });

  provisional.sort((left, right) => right.total - left.total);
  const confidences = softmax(provisional.map((item) => item.total));
  provisional.forEach((item, index) => {
    item.rank = index + 1;
    item.confidence = confidences[index];
  });

  return { ranking: provisional, constraints, reframes };
}

/**
 * Public ranking entry point. It intentionally recomputes the previous turn so
 * rank shifts are derived rather than stored as demo-only annotations.
 */
export function rankConversation(
  scenario: Scenario,
  messages: ConversationMessage[],
  weights: SignalWeights,
): RankingResult {
  const current = rankOnce(scenario, messages, weights);
  const previous =
    messages.length > 1
      ? rankOnce(scenario, messages.slice(0, -1), weights)
      : undefined;

  const previousRankById = new Map(
    previous?.ranking.map((item) => [item.id, item.rank]) ?? [],
  );
  current.ranking.forEach((item) => {
    item.previousRank = previousRankById.get(item.id);
  });

  const top = current.ranking[0];
  const runnerUp = current.ranking[1];
  const margin = top.confidence - runnerUp.confidence;
  let uncertaintyReason: string | undefined;

  if (top.total < 0.52) {
    uncertaintyReason = "no interpretation has enough supporting evidence.";
  } else if (top.confidence < 0.55) {
    uncertaintyReason = "the leading interpretation does not clear 55% confidence.";
  } else if (margin < 0.12) {
    uncertaintyReason = `the top two interpretations are only ${Math.round(
      margin * 100,
    )} points apart.`;
  }

  const uncertain = Boolean(uncertaintyReason);
  // A grounded constraint reversal is sufficient evidence of a reframe; users
  // should not need to include one of a small set of transition words.
  const reframes = current.reframes;

  return {
    ranking: current.ranking,
    constraints: current.constraints,
    reframes,
    uncertain,
    uncertaintyReason,
    explanation: createExplanation(
      current.ranking,
      previous?.ranking,
      weights,
      reframes,
      uncertain,
      uncertaintyReason,
    ),
    processedMessageCount: messages.length,
  };
}
