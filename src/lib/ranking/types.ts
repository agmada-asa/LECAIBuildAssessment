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

/** Minimal input required by the ranker, independent of walkthrough fixtures. */
export type RankingInput = {
  interpretations: Interpretation[];
  constraintRules: ConstraintRule[];
  history: HistoricalTask[];
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
  summary: string;
  previousConstraint: ExtractedConstraint;
  replacementConstraint: ExtractedConstraint;
};

export type SignalScores = Record<SignalKey, number>;

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
};

export type RankingResult = {
  ranking: RankedInterpretation[];
  constraints: ExtractedConstraint[];
  reframes: ReframeEvent[];
  uncertain: boolean;
  uncertaintyReason?: string;
  explanation: string;
  processedMessageCount: number;
};
