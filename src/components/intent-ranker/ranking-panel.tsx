/** @file Ranked candidate cards, detail modal expansion, and winner-movement presentation. */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp02Icon,
  GitCompareIcon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RankedInterpretation, RankingResult, SignalKey } from "@/lib/ranking/types";
import { cn } from "@/lib/utils";
import { percentage, pointDelta, SIGNAL_KEYS, SIGNAL_META } from "./model";
import { SignalBar } from "./signal-display";

/** Returns positive movement for a rise in rank and negative movement for a fall. */
function rankMovement(item: RankedInterpretation): number {
  return item.previousRank ? item.previousRank - item.rank : 0;
}
/** Renders one candidate card with confidence, evidence scores, movement, and a Show more trigger. */
function InterpretationCard({
  item,
  selected,
  accepted,
  onSelect,
  onExpand,
}: {
  item: RankedInterpretation;
  selected: boolean;
  accepted: boolean;
  onSelect: () => void;
  onExpand: () => void;
}) {
  const movement = rankMovement(item);

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group relative w-full cursor-pointer rounded-2xl border bg-card p-4 text-left shadow-xs transition-all duration-200",
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
            <div className="min-w-0 flex-1">
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
              <div className="mt-1.5">
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Show more for #${item.rank}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onExpand();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onExpand();
                    }
                  }}
                  className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-primary hover:underline hover:text-primary/80 transition-colors"
                >
                  Show more
                </span>
              </div>
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
/** Modal dialog displaying complete untruncated candidate details, explanation, and evidence. */
function InterpretationDetailModal({
  item,
  ranking,
  accepted,
  open,
  onOpenChange,
  onSelect,
  onNavigate,
}: {
  item: RankedInterpretation | undefined;
  ranking: RankedInterpretation[];
  accepted: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onNavigate: (id: string) => void;
}) {
  if (!item) return null;

  const movement = rankMovement(item);
  const currentIndex = ranking.findIndex((rankedItem) => rankedItem.id === item.id);
  const prevItem = currentIndex > 0 ? ranking[currentIndex - 1] : undefined;
  const nextItem = currentIndex < ranking.length - 1 ? ranking[currentIndex + 1] : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-xl border font-heading text-sm font-bold",
                item.rank === 1
                  ? "border-primary/20 bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {item.rank}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="font-heading text-lg font-bold leading-6">
                {item.title}
              </DialogTitle>
              {accepted && (
                <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">
                  Accepted
                </Badge>
              )}
              {item.kind && item.kind !== "task" && (
                <Badge variant="outline" className="text-xs">
                  {item.kind === "conversation" ? "Conversation reading" : "Insufficient context"}
                </Badge>
              )}
            </div>
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-semibold text-foreground">
              Confidence: {percentage(item.confidence)}
            </span>
            {item.deltas && (
              <span
                className={cn(
                  "font-mono",
                  item.deltas.confidence > 0
                    ? "text-emerald-700"
                    : item.deltas.confidence < 0
                      ? "text-rose-700"
                      : "text-muted-foreground",
                )}
              >
                ({pointDelta(item.deltas.confidence)})
              </span>
            )}
            <span aria-hidden="true">•</span>
            <span className="font-mono text-muted-foreground">
              Weighted score {item.total.toFixed(3)}
              {item.deltas && (
                <span>{` (${item.deltas.total >= 0 ? "+" : ""}${item.deltas.total.toFixed(3)})`}</span>
              )}
            </span>
            <span aria-hidden="true">•</span>
            {movement !== 0 ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-semibold",
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
              <span className="text-muted-foreground">Rank unchanged</span>
            ) : (
              <span className="text-muted-foreground">New candidate</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Full untruncated summary */}
          <div className="rounded-2xl border bg-muted/20 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Full Summary
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-foreground">
              {item.summary}
            </p>
          </div>

          {/* Why this rank / grounded explanation */}
          <div className="rounded-2xl border bg-muted/20 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Why #{item.rank}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-foreground/85">
              {item.explanation}
            </p>
          </div>

          {/* Scoring Signals */}
          <div className="rounded-2xl border bg-card p-4 space-y-2.5 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Scoring Signals
            </h3>
            <div className="space-y-2 pt-1">
              {SIGNAL_KEYS.map((signal) => (
                <SignalBar
                  key={signal}
                  signal={signal}
                  value={item.signals[signal]}
                  delta={item.deltas?.[signal]}
                />
              ))}
            </div>
          </div>

          {/* Evidence items */}
          {item.evidence.length > 0 && (
            <div className="rounded-2xl border bg-card p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Supporting & Conflicting Evidence
                </h3>
                <span className="font-mono text-xs text-muted-foreground">
                  {item.evidence.length} signals
                </span>
              </div>
              <div className="space-y-2.5">
                {item.evidence.map((evidence, index) => (
                  <div
                    key={`${evidence.kind}-${index}`}
                    className="flex items-start gap-2.5 rounded-xl border bg-muted/20 p-2.5"
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        evidence.sentiment === "conflicts"
                          ? "bg-rose-500"
                          : evidence.kind === "reframe"
                            ? "bg-violet-500"
                            : SIGNAL_META[evidence.kind as SignalKey]?.dot ?? "bg-muted",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-relaxed text-foreground/90">
                        {evidence.text}
                      </p>
                      <p className="mt-1 text-xs font-medium text-muted-foreground">
                        {evidence.messageId ? `${evidence.messageId} · ` : ""}
                        {evidence.kind === "history"
                          ? "Accepted task history"
                          : evidence.kind === "constraints"
                            ? evidence.sentiment === "conflicts"
                              ? "Constraint conflict"
                              : "Constraint match"
                            : "Language match"}
                        {evidence.similarity !== undefined && (
                          <span> · Similarity: {(evidence.similarity * 100).toFixed(0)}%</span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Canonical features and semantic terms if present */}
          {(item.features.length > 0 || item.semanticTerms.length > 0) && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Model Features & Keywords
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {item.features.map((feature) => (
                  <Badge key={feature} variant="secondary" className="font-mono text-[11px]">
                    {feature}
                  </Badge>
                ))}
                {item.semanticTerms.map((term) => (
                  <Badge key={term} variant="outline" className="text-[11px] text-muted-foreground">
                    {term}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!prevItem}
              onClick={() => prevItem && onNavigate(prevItem.id)}
              aria-label="Previous candidate"
              className="gap-1 rounded-xl text-xs"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} className="size-3.5" strokeWidth={2} />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!nextItem}
              onClick={() => nextItem && onNavigate(nextItem.id)}
              aria-label="Next candidate"
              className="gap-1 rounded-xl text-xs"
            >
              Next
              <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" strokeWidth={2} />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                onSelect(item.id);
                onOpenChange(false);
              }}
              className="rounded-xl text-xs"
            >
              Select for workbench
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="rounded-xl text-xs"
            >
              Done
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shows ranked candidates, Show more controls, and the immediately visible decision state. */
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
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);

  const winner = result.ranking[0];
  // Older persisted snapshots predate task-family confidence. Falling back to
  // exact-candidate confidence keeps those records safe to reopen.
  const decisionConfidence = result.decisionConfidence ?? winner.confidence;

  const expandedItem = expandedCandidateId
    ? result.ranking.find((item) => item.id === expandedCandidateId)
    : undefined;

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
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
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
            onExpand={() => setExpandedCandidateId(item.id)}
          />
        ))}
      </div>

      {/* Candidate detail modal */}
      <InterpretationDetailModal
        item={expandedItem}
        ranking={result.ranking}
        accepted={Boolean(
          expandedItem && acceptedInterpretationId === expandedItem.id,
        )}
        open={expandedCandidateId !== null}
        onOpenChange={(open) => {
          if (!open) setExpandedCandidateId(null);
        }}
        onSelect={onSelect}
        onNavigate={(id) => setExpandedCandidateId(id)}
      />
    </section>
  );
}
