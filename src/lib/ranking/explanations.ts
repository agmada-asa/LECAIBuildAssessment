/** @file Grounded candidate, winner-movement, and policy explanations. */

import { normaliseWeights } from "./scoring";
import type {
  ConversationMessage,
  Evidence,
  RankedInterpretation,
  RankingChange,
  RankingResult,
  ReframeEvent,
  SignalKey,
  SignalWeights,
} from "./types";

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  semantic: "semantic similarity",
  constraints: "constraint consistency",
  history: "historical pattern matching",
};

/** Returns the dominant selected axis and the policy reason shown to reviewers. */
export function influentialAxis(
  weights: SignalWeights,
): RankingResult["mostInfluentialAxis"] {
  const effectiveWeights = normaliseWeights(weights);
  const strongestWeight = (
    Object.entries(effectiveWeights) as [SignalKey, number][]
  ).sort((left, right) => right[1] - left[1])[0];
  const rationales: Record<SignalKey, string> = {
    semantic: "the selected policy gives current conversational language the largest share",
    constraints: "explicit instructions should override resemblance and prior habits",
    history: "the selected policy prioritises patterns from accepted prior outcomes",
  };

  return {
    key: strongestWeight[0],
    weight: Math.round(strongestWeight[1] * 1000) / 1000,
    explanation: `${SIGNAL_LABELS[strongestWeight[0]]} received the largest weight (${Math.round(
      strongestWeight[1] * 100,
    )}%) because ${rationales[strongestWeight[0]]}.`,
  };
}

/** Uses stable evidence identity to compare current and previous snapshots. */
export function evidenceKey(evidence: Evidence): string {
  return [evidence.messageId ?? "history", evidence.kind, evidence.sentiment, evidence.text].join(
    "|",
  );
}

/** Summarises one candidate's computed position, movement, and mixed evidence. */
export function candidateExplanation(candidate: RankedInterpretation): string {
  const changedSignals = candidate.change?.materialSignals
    .map(
      (change) =>
        `${SIGNAL_LABELS[change.signal]} ${change.delta >= 0 ? "rose" : "fell"} by ${Math.abs(
          change.delta * 100,
        ).toFixed(1)} points`,
    )
    .join(", ");
  const supporting = candidate.evidence.find((evidence) => evidence.sentiment === "supports");
  const conflicting = candidate.evidence.find((evidence) => evidence.sentiment === "conflicts");
  const statements = [
    `#${candidate.rank} ${candidate.title} has a weighted score of ${candidate.total.toFixed(
      3,
    )} and ${Math.round(candidate.confidence * 100)}% relative confidence.`,
  ];

  if (candidate.change) {
    statements.push(
      changedSignals
        ? `${candidate.change.messageId} changed ${changedSignals}.`
        : `${candidate.change.messageId} did not materially change an individual scoring axis.`,
    );
    statements.push(
      candidate.change.unchangedEvidence.length
        ? `${candidate.change.unchangedEvidence.length} evidence item${candidate.change.unchangedEvidence.length === 1 ? " was" : "s were"} unchanged.`
        : "No evidence item was unchanged from the previous snapshot.",
    );
  }
  if (supporting) statements.push(`Supporting evidence: ${supporting.text}.`);
  if (conflicting) statements.push(`Conflicting evidence: ${conflicting.text}.`);
  return statements.join(" ");
}

/** Finds the largest material movement in one direction for an explanation. */
function strongestChange(
  candidate: RankedInterpretation | undefined,
  direction: "rose" | "fell",
) {
  return candidate?.change?.materialSignals
    .filter((change) => (direction === "rose" ? change.delta > 0 : change.delta < 0))
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))[0];
}

/** Describes actual winner movement across possibly different candidate catalogues. */
export function buildRankingChange(
  current: RankedInterpretation[],
  previous: RankedInterpretation[] | undefined,
  newestMessage: ConversationMessage | undefined,
): RankingChange | undefined {
  const currentWinner = current[0];
  const previousWinner = previous?.[0];
  if (!currentWinner || !previousWinner || !newestMessage) return undefined;

  const previousWinnerNow = current.find((candidate) => candidate.id === previousWinner.id);
  const currentWinnerBefore = previous?.find((candidate) => candidate.id === currentWinner.id);
  const winnerChanged = previousWinner.id !== currentWinner.id;
  const fall = strongestChange(previousWinnerNow, "fell");
  const rise = strongestChange(currentWinner, "rose");

  const previousWinnerExplanation = !winnerChanged
    ? `${previousWinner.title} was #${previousWinner.rank} before ${newestMessage.id}.`
    : previousWinnerNow
      ? `${previousWinner.title} fell from #${previousWinner.rank} to #${previousWinnerNow.rank} after ${newestMessage.id}${
          fall
            ? ` reduced ${SIGNAL_LABELS[fall.signal]} by ${Math.abs(fall.delta * 100).toFixed(1)} points`
            : " changed the competing evidence"
        }.`
      : `${previousWinner.title} is no longer returned by the provider after ${newestMessage.id}.`;
  const currentWinnerExplanation = !winnerChanged
    ? `${currentWinner.title} remained #${currentWinner.rank} after ${newestMessage.id}${
        rise
          ? ` increased ${SIGNAL_LABELS[rise.signal]} by ${(rise.delta * 100).toFixed(1)} points`
          : " changed the competing evidence"
      }.`
    : currentWinnerBefore
      ? `${currentWinner.title} rose from #${currentWinnerBefore.rank} to #${currentWinner.rank} after ${newestMessage.id}${
          rise
            ? ` increased ${SIGNAL_LABELS[rise.signal]} by ${(rise.delta * 100).toFixed(1)} points`
            : " changed the competing evidence"
        }.`
      : `${currentWinner.title} was newly introduced at #${currentWinner.rank} after ${newestMessage.id}.`;

  return {
    messageId: newestMessage.id,
    winnerChanged,
    previousWinner: {
      id: previousWinner.id,
      title: previousWinner.title,
      rank: previousWinner.rank,
      total: previousWinner.total,
      confidence: previousWinner.confidence,
    },
    currentWinner: {
      id: currentWinner.id,
      title: currentWinner.title,
      rank: currentWinner.rank,
      total: currentWinner.total,
      confidence: currentWinner.confidence,
    },
    previousWinnerExplanation,
    currentWinnerExplanation,
  };
}

/** Builds an auditable result-level explanation from stored ranking data. */
export function createExplanation(
  ranking: RankedInterpretation[],
  rankingChange: RankingResult["rankingChange"],
  mostInfluentialAxis: RankingResult["mostInfluentialAxis"],
  latestReframe: ReframeEvent | undefined,
  uncertain: boolean,
  uncertaintyReason?: string,
): string {
  const winner = ranking[0];
  const statements: string[] = [];
  statements.push(
    rankingChange?.winnerChanged
      ? `${winner.title} moved to rank one, replacing ${rankingChange.previousWinner.title.toLowerCase()}.`
      : `${winner.title} is currently the strongest interpretation.`,
  );
  statements.push(mostInfluentialAxis.explanation);

  if (latestReframe) {
    statements.push(
      `The latest message superseded an earlier constraint, replacing “${latestReframe.previousConstraint.label}” with “${latestReframe.replacementConstraint.label}”.`,
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
