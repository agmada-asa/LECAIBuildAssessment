/** @file Ranked candidate cards and winner-movement presentation. */

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown02Icon,
  ArrowUp02Icon,
  GitCompareIcon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RankedInterpretation, RankingResult } from "@/lib/ranking/types";
import { cn } from "@/lib/utils";
import { percentage, pointDelta, SIGNAL_KEYS } from "./model";
import { SignalBar } from "./signal-display";

/** Returns positive movement for a rise in rank and negative movement for a fall. */
function rankMovement(item: RankedInterpretation): number {
  return item.previousRank ? item.previousRank - item.rank : 0;
}

/** Renders one selectable candidate with confidence, evidence scores, and movement. */
function InterpretationCard({
  item,
  selected,
  accepted,
  onSelect,
}: {
  item: RankedInterpretation;
  selected: boolean;
  accepted: boolean;
  onSelect: () => void;
}) {
  const movement = rankMovement(item);

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group w-full rounded-2xl border bg-card p-4 text-left shadow-xs transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md",
        selected && "border-primary/60 ring-3 ring-primary/8",
        accepted && "border-emerald-300 bg-emerald-50/45 ring-3 ring-emerald-500/10",
      )}
    >
      <div className="flex items-start gap-3.5">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl border font-heading text-sm font-bold",
            item.rank === 1
              ? "border-primary/20 bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {item.rank}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-heading text-sm font-semibold leading-5">{item.title}</h3>
                {accepted && (
                  <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">
                    Accepted
                  </Badge>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {item.summary}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-heading text-xl font-semibold tracking-tight tabular-nums">
                {percentage(item.confidence)}
              </p>
              {item.deltas && (
                <p
                  className={cn(
                    "font-mono text-xs",
                    item.deltas.confidence > 0
                      ? "text-emerald-700"
                      : item.deltas.confidence < 0
                        ? "text-rose-700"
                        : "text-muted-foreground",
                  )}
                >
                  {pointDelta(item.deltas.confidence)}
                </p>
              )}
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {SIGNAL_KEYS.map((signal) => (
              <SignalBar
                key={signal}
                signal={signal}
                value={item.signals[signal]}
                delta={item.deltas?.[signal]}
              />
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between border-t pt-2.5">
            {movement !== 0 ? (
              <span
                className={cn(
                  "flex items-center gap-1 text-xs font-semibold",
                  movement > 0 ? "text-emerald-700" : "text-rose-700",
                )}
              >
                <HugeiconsIcon
                  icon={movement > 0 ? ArrowUp02Icon : ArrowDown02Icon}
                  className="size-3"
                  strokeWidth={2.4}
                />
                {Math.abs(movement)} place{Math.abs(movement) === 1 ? "" : "s"}
              </span>
            ) : item.previousRank ? (
              <span className="text-xs text-muted-foreground">Rank unchanged</span>
            ) : (
              <span className="text-xs text-muted-foreground">New candidate</span>
            )}
            <span className="font-mono text-xs text-muted-foreground">
              <span>weighted score {item.total.toFixed(3)}</span>
              {item.deltas && (
                <span>{` (${item.deltas.total >= 0 ? "+" : ""}${item.deltas.total.toFixed(3)})`}</span>
              )}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

/** Shows ranked candidates and the immediately visible decision state. */
export function RankingPanel({
  result,
  selectedId,
  acceptedInterpretationId,
  onSelect,
}: {
  result: RankingResult;
  selectedId: string;
  acceptedInterpretationId?: string;
  onSelect: (id: string) => void;
}) {
  const winner = result.ranking[0];
  // Older persisted snapshots predate task-family confidence. Falling back to
  // exact-candidate confidence keeps those records safe to reopen.
  const decisionConfidence = result.decisionConfidence ?? winner.confidence;

  return (
    <section className="order-1 min-w-0 xl:order-2">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Plausible readings
          </h2>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="About confidence scores"
                  className="text-muted-foreground hover:text-foreground"
                />
              }
            >
              <HugeiconsIcon icon={InformationCircleIcon} className="size-3.5" strokeWidth={2} />
            </TooltipTrigger>
            <TooltipContent className="max-w-64 text-xs">
              The conversation is first checked for an actionable task. Candidate confidence then
              compares compatible readings; it does not measure whether a task exists.
            </TooltipContent>
          </Tooltip>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "h-7 rounded-full px-3 text-xs font-semibold",
            result.uncertain
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800",
          )}
        >
          <span
            className={cn(
              "mr-1.5 size-1.5 rounded-full",
              result.uncertain ? "bg-amber-500" : "bg-emerald-500",
            )}
          />
          {result.uncertain
            ? "Human review"
            : result.conversationAssessment?.kind === "ordinary-conversation"
              ? "No task detected"
              : `Decision ready · ${percentage(decisionConfidence)}`}
        </Badge>
      </div>

      {result.rankingChange?.winnerChanged && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.055] px-4 py-3 text-xs text-foreground"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <HugeiconsIcon icon={GitCompareIcon} className="size-4" strokeWidth={2} />
          </div>
          <p className="leading-5">
            <span className="font-semibold">Ranking shifted.</span>{" "}
            {winner.previousRank
              ? `“${winner.title}” moved from #${winner.previousRank} to #1 after the latest message.`
              : `“${winner.title}” is a newly introduced #1 after the latest message.`}
            <span className="mt-1 block text-muted-foreground">
              {result.rankingChange.previousWinnerExplanation}{" "}
              {result.rankingChange.currentWinnerExplanation}
            </span>
          </p>
        </div>
      )}

      <div className="space-y-3">
        {result.ranking.map((item) => (
          <InterpretationCard
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            accepted={acceptedInterpretationId === item.id}
            onSelect={() => onSelect(item.id)}
          />
        ))}
      </div>
    </section>
  );
}
