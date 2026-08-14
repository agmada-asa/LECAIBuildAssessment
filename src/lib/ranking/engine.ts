/**
 * @file Public orchestration for deterministic ranking and cross-run comparison.
 *
 * Snapshot scoring, constraint extraction, text matching, and explanation
 * rendering live in focused sibling modules. This entry point owns only the
 * result contract and comparison between the current and previous runs.
 */

import { extractConstraints } from "./constraints";
import {
  buildRankingChange,
  candidateExplanation,
  createExplanation,
  evidenceKey,
  influentialAxis,
} from "./explanations";
import { rankSnapshot, round } from "./scoring";
import type {
  ConversationMessage,
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

/** Applies the stable confidence thresholds used by every provider. */
function getUncertaintyReason(
  ranking: RankedInterpretation[],
): string | undefined {
  const top = ranking[0];
  const runnerUp = ranking[1];
  const margin = top.confidence - runnerUp.confidence;

  if (top.total < 0.52) return "no interpretation has enough supporting evidence.";
  if (top.confidence < 0.55) {
    return "the leading interpretation does not clear 55% confidence.";
  }
  if (margin < 0.12) {
    return `the top two interpretations are only ${Math.round(margin * 100)} points apart.`;
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
): RankingResult {
  const current = rankSnapshot(input, messages, weights);
  const previous =
    messages.length > 1
      ? rankSnapshot(previousInput ?? input, messages.slice(0, -1), weights)
      : undefined;
  const newestMessage = messages.at(-1);

  compareCandidates(current.ranking, previous?.ranking, newestMessage);

  const uncertaintyReason = getUncertaintyReason(current.ranking);
  const uncertain = Boolean(uncertaintyReason);
  const latestReframe = newestMessage
    ? [...current.reframes]
        .reverse()
        .find((event) => event.messageId === newestMessage.id)
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
    latestReframe,
    rankingChange,
    mostInfluentialAxis,
    uncertain,
    uncertaintyReason,
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
