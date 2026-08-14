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
  /** Optional participant role/name; explicit assistant/system roles are excluded. */
  author?: string;
  text: string;
  timestamp: string;
};

export type ConversationTransitionKind =
  | "question"
  | "deferral"
  | "resumption"
  | "replacement";

/** A message-level state change kept separate from constraint replacement. */
export type ConversationTransition = {
  messageId: string;
  kind: ConversationTransitionKind;
  summary: string;
};

/** The decision made before candidate ranking begins. */
export type ConversationAssessmentKind =
  | "actionable-task"
  | "ordinary-conversation"
  | "insufficient-context"
  | "undetermined";

/** Provider assessment that separates task existence from topic interpretation. */
export type ConversationAssessment = {
  kind: ConversationAssessmentKind;
  summary: string;
  /** Source messages that support the assessment, validated during normalization. */
  evidenceMessageIds: string[];
  knownFacts: string[];
  /** Material details that cannot be recovered from the supplied log. */
  unknowns: string[];
};

/** Candidate role within the pre-ranking actionability decision. */
export type InterpretationKind =
  | "task"
  | "conversation"
  | "insufficient-context";

export type Interpretation = {
  id: string;
  /** Optional only for persisted results created before actionability gating. */
  kind?: InterpretationKind;
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
  /** Database cosine similarity and tenant provenance when retrieved. */
  similarity?: number;
  userId?: string;
  domainName?: string;
  decision?: "accepted" | "corrected";
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
  /** Absent only for legacy fixtures and persisted results. */
  conversationAssessment?: ConversationAssessment;
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
  /** Scoring component responsible for this item. */
  source?: "embedding" | "lexical" | "constraint" | "history";
  /** Cosine or lexical similarity used to select this evidence. */
  similarity?: number;
  /** Accepted/corrected outcome ID for historical provenance. */
  provenanceId?: string;
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
  kind?: InterpretationKind;
  rank: number;
  previousRank?: number;
  title: string;
  summary: string;
  /** Canonical features retained for clarification and audit output. */
  features: string[];
  semanticTerms: string[];
  signals: SignalScores;
  total: number;
  confidence: number;
  /** False when no source evidence connects this candidate to the active task. */
  valid?: boolean;
  evidence: Evidence[];
  /** Previous values and signed deltas are present whenever a prior message exists. */
  previous?: RankingSnapshot;
  deltas?: RankingDeltas;
  change?: CandidateChange;
  /** Grounded summary for this candidate, not just the winning candidate. */
  explanation: string;
};

export type HumanReviewReasonCode =
  | "none_above"
  | "weak_evidence"
  | "low_relative_confidence"
  | "close_candidates"
  | "insufficient_context"
  | "stale_candidates";

/** Stable policy code plus user-facing explanation for automated routing. */
export type HumanReviewReason = {
  code: HumanReviewReasonCode;
  message: string;
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
  conversationTransitions: ConversationTransition[];
  /** Explicit result of the actionability/context gate that precedes ranking. */
  conversationAssessment: ConversationAssessment;
  /** Present only when the newest message itself changed a constraint. */
  latestReframe?: ReframeEvent;
  rankingChange?: RankingChange;
  mostInfluentialAxis: InfluentialAxis;
  uncertain: boolean;
  uncertaintyReason?: string;
  confidenceLabel: "relative";
  /** Confidence assigned to the winning family of near-identical task variants. */
  decisionConfidence: number;
  /** Winning task-family confidence minus the strongest competing family. */
  decisionMargin: number;
  humanReviewReason?: HumanReviewReason;
  clarificationQuestion?: string;
  /** Versioned embedding model used for messages, candidates, and history. */
  semanticModel: {
    provider: string;
    name: string;
    revision: string;
    version: string;
    dimensions: number;
    deployment: "local" | "hosted";
    purpose: "production" | "demo/test";
    recencyDecay: number;
    /** Ordinary-conversation readings use full-log coverage instead of recency. */
    conversationRecencyDecay: number;
    lexicalFallback: boolean;
  };
  explanation: string;
  processedMessageCount: number;
};
