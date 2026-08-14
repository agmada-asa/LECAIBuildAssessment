/**
 * @file Public orchestration for deterministic ranking and cross-run comparison.
 *
 * Snapshot scoring, constraint extraction, text matching, and explanation
 * rendering live in focused sibling modules. This entry point owns only the
 * result contract and comparison between the current and previous runs.
 */

import {
  classifyConversationTransitions,
  extractConstraints,
  selectActiveTaskMessages,
} from "./constraints";
import {
  calculateTaskFamilyConfidence,
  HUMAN_REVIEW_POLICY,
} from "./confidence";
import {
  buildRankingChange,
  candidateExplanation,
  createExplanation,
  evidenceKey,
  influentialAxis,
} from "./explanations";
import { rankSnapshot, round, softmax, weightedTotal } from "./scoring";
import { embeddingProvider } from "@/lib/embeddings/provider";
import type { EmbeddingProvider, PreparableEmbeddingProvider } from "@/lib/embeddings/types";
import { SEMANTIC_RECENCY_DECAY } from "./scoring";
import type {
  ConversationMessage,
  HumanReviewReason,
  RankedInterpretation,
  RankingInput,
  RankingResult,
  SignalKey,
  SignalWeights,
} from "./types";

export { extractConstraints };

/** Adds prior values, signed deltas, and evidence changes to matching candidates. */
function compareCandidates(
  current: RankedInterpretation[],
  previous: RankedInterpretation[] | undefined,
  newestMessage: ConversationMessage | undefined,
): void {
  const previousById = new Map(previous?.map((item) => [item.id, item]) ?? []);

  current.forEach((item) => {
    const prior = previousById.get(item.id);
    if (prior && newestMessage) {
      item.previousRank = prior.rank;
      item.previous = {
        rank: prior.rank,
        signals: { ...prior.signals },
        total: prior.total,
        confidence: prior.confidence,
      };
      item.deltas = {
        semantic: round(item.signals.semantic - prior.signals.semantic),
        constraints: round(item.signals.constraints - prior.signals.constraints),
        history: round(item.signals.history - prior.signals.history),
        total: round(item.total - prior.total),
        confidence: round(item.confidence - prior.confidence),
        rank: prior.rank - item.rank,
      };

      const currentEvidence = new Map(
        item.evidence.map((evidence) => [evidenceKey(evidence), evidence]),
      );
      const previousEvidence = new Map(
        prior.evidence.map((evidence) => [evidenceKey(evidence), evidence]),
      );
      item.change = {
        messageId: newestMessage.id,
        addedEvidence: [...currentEvidence]
          .filter(([key]) => !previousEvidence.has(key))
          .map(([, evidence]) => evidence),
        removedEvidence: [...previousEvidence]
          .filter(([key]) => !currentEvidence.has(key))
          .map(([, evidence]) => evidence),
        unchangedEvidence: [...currentEvidence]
          .filter(([key]) => previousEvidence.has(key))
          .map(([, evidence]) => evidence),
        materialSignals: (Object.keys(item.signals) as SignalKey[])
          .filter((signal) => Math.abs(item.signals[signal] - prior.signals[signal]) >= 0.001)
          .map((signal) => ({
            signal,
            messageId: newestMessage.id,
            previous: prior.signals[signal],
            current: item.signals[signal],
            delta: round(item.signals[signal] - prior.signals[signal]),
          })),
      };
    }

    item.explanation = candidateExplanation(item);
  });
}

/** Applies independently testable confidence thresholds used by every provider. */
export function evaluateHumanReview(
  ranking: RankedInterpretation[],
): HumanReviewReason | undefined {
  if (!ranking.some((candidate) => candidate.valid !== false)) {
    return {
      code: "none_above",
      message: "none of the proposed interpretations is grounded in the active task.",
    };
  }
  const top = ranking[0];
  if (top.kind === "insufficient-context") {
    return {
      code: "insufficient_context",
      message: "the underlying action or topic cannot be recovered from the supplied messages.",
    };
  }
  if (top.kind === "conversation") return undefined;
  const taskFamily = calculateTaskFamilyConfidence(ranking);

  if (top.total < HUMAN_REVIEW_POLICY.minimumTotal) {
    return {
      code: "weak_evidence",
      message: "no interpretation has enough supporting evidence.",
    };
  }
  if (taskFamily.confidence < HUMAN_REVIEW_POLICY.minimumRelativeConfidence) {
    return {
      code: "low_relative_confidence",
      message: "the leading task family does not clear 55% relative confidence.",
    };
  }
  if (taskFamily.margin < HUMAN_REVIEW_POLICY.minimumTopFamilyMargin) {
    return {
      code: "close_candidates",
      message: `the top two task families are only ${Math.round(taskFamily.margin * 100)} points apart.`,
    };
  }
  return undefined;
}

/** Builds a concise question from the first differing canonical feature. */
export function generateClarificationQuestion(
  top: Pick<RankedInterpretation, "title" | "features">,
  runnerUp: Pick<RankedInterpretation, "title" | "features">,
): string | undefined {
  const topFeatures = new Map(
    top.features.map((feature) => feature.split(":", 2) as [string, string]),
  );
  const runnerFeatures = new Map(
    runnerUp.features.map((feature) => feature.split(":", 2) as [string, string]),
  );
  for (const [dimension, topValue] of topFeatures) {
    const runnerValue = runnerFeatures.get(dimension);
    if (runnerValue && runnerValue !== topValue) {
      const readable = (value: string) => value.replace(/-/g, " ");
      return `Should the ${readable(dimension)} be ${readable(topValue)} or ${readable(runnerValue)}?`;
    }
  }
  return undefined;
}

/**
 * Ranks the current log and compares it with the immediately previous message.
 *
 * @param input Current provider-normalized candidate catalogue and evidence rules.
 * @param messages Complete ordered message list for the current run.
 * @param weights Raw policy weights, normalized before scoring.
 * @param previousInput Candidate catalogue shown by the prior provider run. When
 * omitted, the current catalogue is used for a first-time within-log comparison.
 * @returns A complete ranking, audit trail, deltas, and human-review policy.
 */
export function rankConversation(
  input: RankingInput,
  messages: ConversationMessage[],
  weights: SignalWeights,
  previousInput?: RankingInput,
  embeddings: EmbeddingProvider = embeddingProvider,
): RankingResult {
  const current = rankSnapshot(input, messages, weights, embeddings);
  const previous =
    messages.length > 1
      ? rankSnapshot(
          previousInput ?? input,
          messages.slice(0, -1),
          weights,
          embeddings,
        )
      : undefined;
  const newestMessage = messages.at(-1);

  compareCandidates(current.ranking, previous?.ranking, newestMessage);

  let humanReviewReason = evaluateHumanReview(current.ranking);
  const taskFamily = calculateTaskFamilyConfidence(current.ranking);
  const latestReframe = newestMessage
    ? [...current.reframes]
        .reverse()
        .find((event) => event.messageId === newestMessage.id)
    : undefined;
  const latestBoundary = newestMessage
    ? input.taskBoundaries?.find((boundary) => boundary.messageId === newestMessage.id)
    : undefined;
  if (latestBoundary) {
    const activeTopic = current.activeConstraints.find(
      (constraint) =>
        constraint.mode === "require" &&
        (constraint.dimension === "topic" || constraint.dimension === "task"),
    );
    if (
      activeTopic &&
      !current.ranking.some((candidate) =>
        candidate.features.includes(`${activeTopic.dimension}:${activeTopic.value}`),
      )
    ) {
      humanReviewReason = {
        code: "stale_candidates",
        message: "the latest task switch is not represented by any current interpretation.",
      };
    }
  }
  const uncertaintyReason = humanReviewReason?.message;
  const uncertain = Boolean(humanReviewReason);
  const clarificationQuestion = uncertain &&
    !["none_above", "insufficient_context"].includes(humanReviewReason?.code ?? "")
    ? generateClarificationQuestion(current.ranking[0], current.ranking[1])
    : undefined;
  const mostInfluentialAxis = influentialAxis(weights);
  const rankingChange = buildRankingChange(
    current.ranking,
    previous?.ranking,
    newestMessage,
  );

  return {
    ranking: current.ranking,
    constraints: current.constraints,
    activeConstraints: current.activeConstraints,
    reframes: current.reframes,
    conversationTransitions: classifyConversationTransitions(
      messages,
      input.taskBoundaries,
    ),
    conversationAssessment: input.conversationAssessment ?? {
      kind: "undetermined",
      summary: "This legacy result was ranked without an actionability assessment.",
      evidenceMessageIds: [],
      knownFacts: [],
      unknowns: [],
    },
    latestReframe,
    rankingChange,
    mostInfluentialAxis,
    uncertain,
    uncertaintyReason,
    confidenceLabel: "relative",
    decisionConfidence: taskFamily.confidence,
    decisionMargin: taskFamily.margin,
    humanReviewReason,
    clarificationQuestion,
    semanticModel: {
      ...embeddings.model,
      recencyDecay: SEMANTIC_RECENCY_DECAY,
      conversationRecencyDecay: 1,
      lexicalFallback: true,
    },
    explanation: createExplanation(
      current.ranking,
      rankingChange,
      mostInfluentialAxis,
      latestReframe,
      uncertain,
      uncertaintyReason,
    ),
    processedMessageCount: messages.length,
  };
}

/** Lists every string that a provider must embed before synchronous scoring. */
function embeddingTexts(
  input: RankingInput,
  messages: ConversationMessage[],
  previousInput?: RankingInput,
): string[] {
  const catalogues = previousInput ? [input, previousInput] : [input];
  return [
    ...messages.map((message) => message.text),
    ...catalogues.flatMap((catalogue) =>
      catalogue.interpretations.map((interpretation) =>
        [
          interpretation.title,
          interpretation.summary,
          ...interpretation.semanticTerms,
        ].join(". "),
      ),
    ),
    ...catalogues.flatMap((catalogue) =>
      catalogue.history.map((task) => `${task.summary}. ${task.terms.join(". ")}`),
    ),
    selectActiveTaskMessages(messages, input.taskBoundaries)
      .map((message) => message.text)
      .join(" "),
    selectActiveTaskMessages(
      messages.slice(0, -1),
      (previousInput ?? input).taskBoundaries,
    )
      .map((message) => message.text)
      .join(" "),
  ];
}

/** Prepares a network-backed embedding cache, then runs the common ranker. */
export async function rankConversationAsync(
  input: RankingInput,
  messages: ConversationMessage[],
  weights: SignalWeights,
  previousInput: RankingInput | undefined,
  embeddings: EmbeddingProvider,
): Promise<RankingResult> {
  const preparable = embeddings as Partial<PreparableEmbeddingProvider>;
  if (preparable.prepare) {
    await preparable.prepare(embeddingTexts(input, messages, previousInput));
  }
  return rankConversation(input, messages, weights, previousInput, embeddings);
}

/**
 * Reweights already-computed axes without changing the embedding model or
 * repeating provider work. Conversation deltas are cleared because they were
 * calculated under the preceding policy and would otherwise be misleading.
 */
export function reweightRankingResult(
  source: RankingResult,
  weights: SignalWeights,
): RankingResult {
  const ranking = source.ranking
    .map((item) => ({
      ...item,
      signals: { ...item.signals },
      evidence: item.evidence.map((evidence) => ({ ...evidence })),
      total: weightedTotal(item.signals, weights),
      confidence: 0,
      previousRank: undefined,
      previous: undefined,
      deltas: undefined,
      change: undefined,
    }))
    .sort(
      (left, right) =>
        Number(right.valid !== false) - Number(left.valid !== false) ||
        right.total - left.total,
    );
  const validItems = ranking.filter((item) => item.valid !== false);
  const confidences = validItems.length
    ? softmax(validItems.map((item) => item.total))
    : [];
  ranking.forEach((item, index) => {
    item.rank = index + 1;
    const validIndex = validItems.indexOf(item);
    item.confidence = validIndex >= 0 ? confidences[validIndex] : 0;
    item.explanation = candidateExplanation(item);
  });
  const humanReviewReason =
    source.humanReviewReason?.code === "stale_candidates"
      ? source.humanReviewReason
      : evaluateHumanReview(ranking);
  const taskFamily = calculateTaskFamilyConfidence(ranking);
  const uncertain = Boolean(humanReviewReason);
  const mostInfluentialAxis = influentialAxis(weights);
  return {
    ...source,
    ranking,
    rankingChange: undefined,
    mostInfluentialAxis,
    uncertain,
    uncertaintyReason: humanReviewReason?.message,
    humanReviewReason,
    decisionConfidence: taskFamily.confidence,
    decisionMargin: taskFamily.margin,
    clarificationQuestion: uncertain &&
      !["none_above", "insufficient_context"].includes(humanReviewReason?.code ?? "")
      ? generateClarificationQuestion(ranking[0], ranking[1])
      : undefined,
    explanation: createExplanation(
      ranking,
      undefined,
      mostInfluentialAxis,
      source.latestReframe,
      uncertain,
      humanReviewReason?.message,
    ),
  };
}
