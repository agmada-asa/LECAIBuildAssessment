/**
 * @file Provider-neutral contract used by local agent adapters.
 *
 * Providers only propose structured interpretations and constraints. The
 * deterministic ranking engine remains responsible for weights, confidence,
 * explanations, and human-review decisions.
 */
export type ProviderId = "demo" | "codex" | "api";

export type ProviderStatus = {
  id: ProviderId;
  name: string;
  available: boolean;
  localInference: boolean;
  detail: string;
};

export type ProviderInterpretation = {
  id: string;
  title: string;
  summary: string;
  semanticTerms: string[];
  features: string[];
};

export type ProviderConstraint = {
  id: string;
  phrases: string[];
  dimension: string;
  value: string;
  mode: "require" | "forbid";
  strength: number;
  label: string;
};

export type ProviderTaskBoundary = {
  /** Exact canonical source-message ID where the unrelated replacement begins. */
  messageId: string;
  reason: string;
};

export type ProviderAnalysis = {
  interpretations: ProviderInterpretation[];
  constraints: ProviderConstraint[];
  taskBoundaries?: ProviderTaskBoundary[];
  notes: string;
};
