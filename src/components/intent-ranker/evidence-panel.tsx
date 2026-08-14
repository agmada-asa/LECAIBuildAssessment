/** @file Auditable ranking explanation, reframe, delta, and evidence panel. */

import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, GitCompareIcon, SparklesIcon } from "@hugeicons/core-free-icons";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type {
  RankedInterpretation,
  RankingResult,
  SignalKey,
} from "@/lib/ranking/types";
import { cn } from "@/lib/utils";
import { percentage, pointDelta, SIGNAL_META } from "./model";

/** Shows a faithful explanation assembled from the computed evidence. */
export function EvidencePanel({
  result,
  selected,
}: {
  result: RankingResult;
  selected: RankedInterpretation;
}) {
  return (
    <aside className="space-y-3 xl:sticky xl:top-[88px] xl:self-start">
      <Card className="gap-0 overflow-hidden rounded-2xl py-0 shadow-sm">
        <CardHeader className="border-b bg-muted/25 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-sm font-semibold">Why this ranking?</h2>
            <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
              <HugeiconsIcon icon={SparklesIcon} className="size-4" strokeWidth={2} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 py-4">
          <p className="text-[12px] leading-[1.65] text-foreground/85">{result.explanation}</p>

          {result.latestReframe && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-3.5">
              <div className="flex items-center gap-2 text-violet-900">
                <HugeiconsIcon icon={GitCompareIcon} className="size-4" strokeWidth={2} />
                <p className="text-[11px] font-semibold">Reframe detected</p>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-violet-900/75">
                {result.latestReframe.summary} The newer message is retained in the audit trail
                while the earlier constraint is marked superseded.
              </p>
            </div>
          )}

          {!result.latestReframe && result.reframes.length > 0 && (
            <p className="text-[10px] leading-4 text-muted-foreground">
              {result.reframes.length} earlier constraint change
              {result.reframes.length === 1 ? " is" : "s are"} retained in the audit trail; the
              latest message did not create another reframe.
            </p>
          )}

          {result.uncertain && (
            <Alert className="rounded-xl border-amber-200 bg-amber-50/70 text-amber-950">
              <HugeiconsIcon icon={Alert02Icon} className="size-4" strokeWidth={2} />
              <AlertTitle className="text-xs font-semibold">Ask before acting</AlertTitle>
              <AlertDescription className="text-[11px] leading-4 text-amber-900/80">
                {result.uncertaintyReason} Ask: “Should this be a reusable live view or a report
                delivered each Monday?”
              </AlertDescription>
            </Alert>
          )}

          {result.rankingChange && (
            <div className="grid grid-cols-2 gap-2 rounded-xl border bg-muted/25 p-3">
              <div>
                <p className="text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Previous winner
                </p>
                <p className="mt-1 text-[11px] font-semibold">
                  Previous: {result.rankingChange.previousWinner.title}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Current winner
                </p>
                <p className="mt-1 text-[11px] font-semibold">
                  Current: {result.rankingChange.currentWinner.title}
                </p>
              </div>
            </div>
          )}

          <Separator />

          <div>
            <h3 className="text-xs font-semibold">Why #{selected.rank}</h3>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              {selected.explanation}
            </p>
          </div>

          {selected.change && (
            <>
              <Separator />
              <div className="space-y-3">
                <div>
                  <h3 className="text-xs font-semibold">
                    Changed with {selected.change.messageId}
                  </h3>
                  <div className="mt-2 space-y-1 text-[10px] leading-4 text-muted-foreground">
                    {selected.change.materialSignals.length > 0 ? (
                      selected.change.materialSignals.map((change) => (
                        <p key={change.signal}>
                          {SIGNAL_META[change.signal].label}: {percentage(change.previous)} →{" "}
                          {percentage(change.current)} ({pointDelta(change.delta)})
                        </p>
                      ))
                    ) : (
                      <p>No individual scoring axis changed materially.</p>
                    )}
                    {selected.change.addedEvidence.slice(0, 3).map((evidence, index) => (
                      <p key={`added-${evidence.kind}-${index}`}>
                        Added evidence{evidence.messageId ? ` from ${evidence.messageId}` : ""}:{" "}
                        {evidence.text}
                      </p>
                    ))}
                    {selected.change.removedEvidence.slice(0, 3).map((evidence, index) => (
                      <p key={`removed-${evidence.kind}-${index}`}>
                        No longer used{evidence.messageId ? ` from ${evidence.messageId}` : ""}:{" "}
                        {evidence.text}
                      </p>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold">Unchanged evidence</h3>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                    {selected.change.unchangedEvidence.length
                      ? `${selected.change.unchangedEvidence.length} evidence item${selected.change.unchangedEvidence.length === 1 ? " remained" : "s remained"} applicable.`
                      : "No prior evidence item remained applicable."}
                  </p>
                  {selected.change.unchangedEvidence
                    .slice(0, 3)
                    .map((evidence, index) => (
                      <p
                        key={`unchanged-${evidence.kind}-${index}`}
                        className="mt-1 text-[10px] leading-4 text-muted-foreground"
                      >
                        {evidence.messageId ? `${evidence.messageId}: ` : ""}
                        {evidence.text}
                      </p>
                    ))}
                </div>
              </div>
            </>
          )}

          <Separator />

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted-foreground">
                Evidence for #{selected.rank}
              </h3>
              <span className="font-mono text-[10px] text-muted-foreground">
                {selected.evidence.length} signals
              </span>
            </div>
            <div className="space-y-2.5">
              {selected.evidence.slice(0, 6).map((evidence, index) => (
                <div key={`${evidence.kind}-${index}`} className="flex gap-2.5">
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
                  <div>
                    <p className="text-[11px] leading-4 text-foreground/85">{evidence.text}</p>
                    <p className="mt-0.5 text-[9px] font-medium text-muted-foreground">
                      {evidence.messageId ? `${evidence.messageId} · ` : ""}
                      {evidence.kind === "history"
                        ? "Accepted task history"
                        : evidence.kind === "constraints"
                          ? evidence.sentiment === "conflicts"
                            ? "Constraint conflict"
                            : "Constraint match"
                          : "Language match"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </aside>
  );
}
