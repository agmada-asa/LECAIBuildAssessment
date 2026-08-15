/** @file Production scoring weights and user-selectable weighting policies. */

import type { SignalWeights } from "./types";

/** Direct user constraints take precedence over resemblance and prior habits. */
export const DEFAULT_WEIGHTS: SignalWeights = {
  semantic: 30,
  constraints: 50,
  history: 20,
};

/** Named policies available in the ranking settings interface. */
export const WEIGHT_PRESETS: Record<
  string,
  { label: string; description: string; weights: SignalWeights }
> = {
  explicit: {
    label: "Explicit instructions first",
    description: "Current constraints override prior habits.",
    weights: DEFAULT_WEIGHTS,
  },
  balanced: {
    label: "Balanced",
    description: "Treat all three evidence sources similarly.",
    weights: { semantic: 35, constraints: 40, history: 25 },
  },
  history: {
    label: "History-aware",
    description: "Give recurring user patterns more influence.",
    weights: { semantic: 30, constraints: 35, history: 35 },
  },
};
