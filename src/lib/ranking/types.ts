/**
 * @file Shared domain types for the intent-ranking engine.
 *
 * Keeping these types independent from React makes the ranking logic usable by
 * the browser demo, API routes, command-line providers, and automated tests.
 */

export type SignalKey = "semantic" | "constraints" | "history";

export type SignalWeights = Record<SignalKey, number>;

export type ConversationMessage = {
  id: string;
  /** Optional source label retained for compatibility; ranking is role-neutral. */
  author?: string;
  text: string;
  timestamp: string;
};

export type Interpretation = {
  id: string;
  title: string;
  summary: string;
  /** Phrases used by the transparent local semantic scorer. */
  semanticTerms: string[];
  /** Canonical feature tags, for example `format:slides`. */
  features: string[];
};

export type ConstraintMode = "require" | "forbid";

export type ConstraintRule = {
  id: string;
  /** Plain phrases are intentionally inspectable and easy to extend. */
  phrases: string[];
  dimension: string;
  value: string;
  mode: ConstraintMode;
  strength: number;
  label: string;
};

export type HistoricalTask = {
  id: string;
  interpretationId?: string;
  summary: string;
  terms: string[];
  accepted: boolean;
};

/** Provider-grounded point where a message replaces the preceding task wholesale. */
export type TaskBoundary = {
  messageId: string;
  reason: string;
};

/** Minimal input required by the ranker, independent of walkthrough fixtures. */
export type RankingInput = {
  interpretations: Interpretation[];
  constraintRules: ConstraintRule[];
  history: HistoricalTask[];
  /** Semantic task switches detected upstream; absent for legacy fixtures. */
  taskBoundaries?: TaskBoundary[];
};

export type Scenario = RankingInput & {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  userName: string;
  userRole: string;
  messages: ConversationMessage[];
  interpretations: Interpretation[];
  constraintRules: ConstraintRule[];
  history: HistoricalTask[];
};

export type Evidence = {
  messageId?: string;
  text: string;
  kind: SignalKey | "reframe";
  sentiment: "supports" | "conflicts" | "neutral";
};

export type ExtractedConstraint = ConstraintRule & {
  messageId: string;
  messageIndex: number;
  matchedPhrase: string;
  superseded: boolean;
};

export type ReframeEvent = {
  messageId: string;
  /** A task switch invalidates all prior dimensions; a constraint change replaces one. */
  kind: "constraint-change" | "task-switch";
  /** Semantic provider rationale for a whole-task boundary, when available. */
  reason?: string;
  summary: string;
  previousConstraint: ExtractedConstraint;
  replacementConstraint: ExtractedConstraint;
};

export type SignalScores = Record<SignalKey, number>;

/** Complete prior state retained beside a candidate's current scores. */
export type RankingSnapshot = {
  rank: number;
  signals: SignalScores;
  total: number;
  confidence: number;
};

/** Current-minus-previous score changes; positive rank means the candidate rose. */
export type RankingDeltas = SignalScores & {
  total: number;
  confidence: number;
  rank: number;
};

/** One materially changed scoring axis traced to the newly processed message. */
export type MaterialSignalChange = {
  signal: SignalKey;
  messageId: string;
  previous: number;
  current: number;
  delta: number;
};

/** Evidence comparison for the immediately previous and current snapshots. */
export type CandidateChange = {
  messageId: string;
  addedEvidence: Evidence[];
  removedEvidence: Evidence[];
  unchangedEvidence: Evidence[];
  materialSignals: MaterialSignalChange[];
};

export type RankedInterpretation = {
  id: string;
  rank: number;
  previousRank?: number;
  title: string;
  summary: string;
  signals: SignalScores;
  total: number;
  confidence: number;
  evidence: Evidence[];
  /** Previous values and signed deltas are present whenever a prior message exists. */
  previous?: RankingSnapshot;
  deltas?: RankingDeltas;
  change?: CandidateChange;
  /** Grounded summary for this candidate, not just the winning candidate. */
  explanation: string;
};

export type RankingWinner = {
  id: string;
  title: string;
  rank: number;
  total: number;
  confidence: number;
};

/** Describes winner movement between the last two conversation snapshots. */
export type RankingChange = {
  messageId: string;
  winnerChanged: boolean;
  previousWinner: RankingWinner;
  currentWinner: RankingWinner;
  previousWinnerExplanation: string;
  currentWinnerExplanation: string;
};

/** Makes the selected policy's dominant axis and rationale machine-readable. */
export type InfluentialAxis = {
  key: SignalKey;
  weight: number;
  explanation: string;
};

export type RankingResult = {
  ranking: RankedInterpretation[];
  constraints: ExtractedConstraint[];
  /** One canonical active value per dimension for direct inspection. */
  activeConstraints: ExtractedConstraint[];
  reframes: ReframeEvent[];
  /** Present only when the newest message itself changed a constraint. */
  latestReframe?: ReframeEvent;
  rankingChange?: RankingChange;
  mostInfluentialAxis: InfluentialAxis;
  uncertain: boolean;
  uncertaintyReason?: string;
  explanation: string;
  processedMessageCount: number;
};
