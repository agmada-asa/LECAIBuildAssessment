/** @file Compact visual treatments for ranking weights and signal scores. */

import { cn } from "@/lib/utils";
import type { SignalKey, SignalWeights } from "@/lib/ranking/types";
import { percentage, pointDelta, SIGNAL_KEYS, SIGNAL_META } from "./model";

/** Visual summary of the active ranking policy. */
export function WeightStrip({ weights }: { weights: SignalWeights }) {
  const total = weights.semantic + weights.constraints + weights.history;

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {SIGNAL_KEYS.map((key) => (
        <div
          key={key}
          className={cn("h-full transition-[width] duration-300", SIGNAL_META[key].color)}
          style={{ width: `${(weights[key] / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

/** Visualises one independent signal without implying it is the final score. */
export function SignalBar({
  signal,
  value,
  delta,
}: {
  signal: SignalKey;
  value: number;
  delta?: number;
}) {
  return (
    <div className="grid grid-cols-[92px_1fr_72px] items-center gap-2.5">
      <span className="text-xs font-medium text-muted-foreground">
        {SIGNAL_META[signal].shortLabel}
      </span>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            SIGNAL_META[signal].color,
          )}
          style={{ width: percentage(value) }}
        />
      </div>
      <span className="text-right font-mono text-xs font-semibold tabular-nums text-muted-foreground">
        {percentage(value)}
        {delta !== undefined && (
          <span
            className={cn(
              "ml-1",
              delta > 0
                ? "text-emerald-700"
                : delta < 0
                  ? "text-rose-700"
                  : "text-muted-foreground",
            )}
          >
            {pointDelta(delta)}
          </span>
        )}
      </span>
    </div>
  );
}
