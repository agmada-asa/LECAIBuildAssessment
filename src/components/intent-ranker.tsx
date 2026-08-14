"use client";

/**
 * @file Stateful intent-ranking workbench and its focused presentation units.
 *
 * The client owns only ephemeral walkthrough state. Ranking decisions remain
 * deterministic domain logic, while CLI execution stays behind server routes.
 */

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AiBrain03Icon,
  Alert02Icon,
  ArrowDown02Icon,
  ArrowRight01Icon,
  ArrowUp02Icon,
  BotIcon,
  GitCompareIcon,
  InformationCircleIcon,
  PlayIcon,
  Refresh01Icon,
  Settings01Icon,
  SlidersHorizontalIcon,
  SparklesIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProviderStatus } from "@/lib/providers/types";
import type { ProviderId } from "@/lib/providers/types";
import {
  ConversationImportError,
  parseConversationInput,
} from "@/lib/conversations/import";
import type { ConversationLog } from "@/lib/conversations/schema";
import type { RankErrorResponse, RankSuccessResponse } from "@/lib/ranking/api";
import { rankConversation } from "@/lib/ranking/engine";
import {
  DEFAULT_WEIGHTS,
  getScenario,
  SCENARIOS,
  WEIGHT_PRESETS,
} from "@/lib/ranking/scenarios";
import type {
  ConversationMessage,
  RankedInterpretation,
  RankingInput,
  RankingResult,
  SignalKey,
  SignalWeights,
  Scenario,
} from "@/lib/ranking/types";
import { cn } from "@/lib/utils";

const SIGNAL_META: Record<
  SignalKey,
  { label: string; shortLabel: string; color: string; dot: string }
> = {
  semantic: {
    label: "Semantic similarity",
    shortLabel: "Semantic",
    color: "bg-sky-500",
    dot: "bg-sky-500",
  },
  constraints: {
    label: "Constraint consistency",
    shortLabel: "Constraints",
    color: "bg-primary",
    dot: "bg-primary",
  },
  history: {
    label: "Historical pattern",
    shortLabel: "History",
    color: "bg-violet-500",
    dot: "bg-violet-500",
  },
};

const SIGNAL_KEYS = Object.keys(SIGNAL_META) as SignalKey[];

/** Formats a normalised value as a whole-number percentage for compact UI labels. */
function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Converts a walkthrough snapshot into the same canonical log used by imports. */
function scenarioConversationLog(
  scenario: Scenario,
  messages: ConversationMessage[],
): ConversationLog {
  return {
    conversationId: scenario.id,
    userId: scenario.userName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    domain: { name: scenario.userRole },
    messages: messages.map((message, index) => ({
      ...message,
      timestamp: Number.isNaN(Date.parse(message.timestamp))
        ? `2026-08-14T${message.timestamp}:00.000Z`
        : new Date(message.timestamp).toISOString(),
      id: message.id || `M${index + 1}`,
    })),
    acceptedOutcomes: scenario.history
      .filter((outcome) => outcome.accepted)
      .map((outcome) => ({
        id: outcome.id,
        interpretationId: outcome.interpretationId,
        title:
          scenario.interpretations.find((item) => item.id === outcome.interpretationId)
            ?.title ?? "Accepted task",
        summary: outcome.summary,
        semanticTerms: outcome.terms,
      })),
  };
}

/** Returns the first generated ID that does not collide with source IDs. */
function nextMessageId(messages: ConversationMessage[]): string {
  const usedIds = new Set(messages.map((message) => message.id));
  let suffix = messages.length + 1;
  while (usedIds.has(`M${suffix}`)) suffix += 1;
  return `M${suffix}`;
}

/** Sends one complete canonical log to the unified server pipeline. */
async function requestRanking(
  conversation: ConversationLog,
  provider: ProviderId,
  weights: SignalWeights,
): Promise<RankSuccessResponse> {
  const response = await fetch("/api/rank", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, conversation, weights }),
  });
  const body = (await response.json()) as RankSuccessResponse | RankErrorResponse;
  if (!response.ok || "error" in body) {
    throw new Error(
      "error" in body ? body.error.message : "The ranking service returned an invalid response.",
    );
  }
  return body;
}

/** Returns positive movement for a rise in rank and negative movement for a fall. */
function rankMovement(item: RankedInterpretation): number {
  return item.previousRank ? item.previousRank - item.rank : 0;
}

/** Compact visual summary of the active ranking policy. */
function WeightStrip({ weights }: { weights: SignalWeights }) {
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
function SignalBar({ signal, value }: { signal: SignalKey; value: number }) {
  return (
    <div className="grid grid-cols-[92px_1fr_34px] items-center gap-2.5">
      <span className="text-[11px] font-medium text-muted-foreground">
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
      <span className="text-right font-mono text-[10px] font-semibold tabular-nums text-muted-foreground">
        {percentage(value)}
      </span>
    </div>
  );
}

/** Left rail: the exact conversational evidence processed so far. */
function ConversationPanel({
  messages,
  totalFixtureMessages,
  userName,
  userRole,
  isProcessing,
  customMessage,
  onCustomMessageChange,
  onAddCustomMessage,
  onProcessNext,
  onReset,
}: {
  messages: ConversationMessage[];
  totalFixtureMessages: number;
  userName: string;
  userRole: string;
  isProcessing: boolean;
  customMessage: string;
  onCustomMessageChange: (value: string) => void;
  onAddCustomMessage: () => void;
  onProcessNext: () => void;
  onReset: () => void;
}) {
  const fixtureMessagesRead = Math.min(messages.length, totalFixtureMessages);
  const canProcessFixture = fixtureMessagesRead < totalFixtureMessages;

  return (
    <section className="flex min-h-[580px] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm xl:h-[calc(100vh-104px)]">
      <div className="border-b px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-base font-semibold">Conversation</h2>
          <Badge variant="secondary" className="rounded-full px-2.5 font-mono text-[10px]">
            {fixtureMessagesRead}/{totalFixtureMessages} read
          </Badge>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl border bg-muted/35 p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <HugeiconsIcon icon={UserIcon} className="size-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{userName}</p>
            <p className="truncate text-xs text-muted-foreground">{userRole}</p>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-5">
          {messages.map((message, index) => (
            <div
              key={message.id}
              className="animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <span className="font-mono text-[10px] font-semibold text-muted-foreground">
                  {message.id}
                </span>
                <span className="text-[10px] text-muted-foreground/70">{message.timestamp}</span>
                {index === messages.length - 1 && (
                  <Badge className="ml-auto h-5 rounded-full bg-primary/10 px-2 text-[9px] text-primary shadow-none">
                    Latest
                  </Badge>
                )}
              </div>
              <div className="rounded-2xl rounded-tl-sm border bg-background px-4 py-3.5 text-[13px] leading-5 shadow-xs">
                {message.text}
              </div>
            </div>
          ))}

          {isProcessing && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground"
            >
              <span className="flex gap-1">
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="size-1.5 animate-pulse rounded-full bg-primary"
                    style={{ animationDelay: `${dot * 120}ms` }}
                  />
                ))}
              </span>
              Updating evidence and scores…
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="space-y-3 border-t bg-muted/20 p-4">
        {canProcessFixture ? (
          <Button
            className="w-full rounded-xl"
            onClick={onProcessNext}
            disabled={isProcessing}
          >
            <HugeiconsIcon icon={PlayIcon} className="size-4" strokeWidth={2} />
            Process next message
          </Button>
        ) : (
          <div className="relative">
            <Textarea
              aria-label="Add a follow-up message"
              value={customMessage}
              onChange={(event) => onCustomMessageChange(event.target.value)}
              disabled={isProcessing}
              placeholder="Add a follow-up to test the ranking…"
              className="min-h-20 resize-none rounded-xl bg-background pr-12 text-xs"
            />
            <Button
              aria-label="Add follow-up message"
              size="icon"
              className="absolute right-2 bottom-2 size-8 rounded-lg"
              onClick={onAddCustomMessage}
              disabled={isProcessing || !customMessage.trim()}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" strokeWidth={2} />
            </Button>
          </div>
        )}
        <button
          type="button"
          onClick={onReset}
          className="flex w-full items-center justify-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={Refresh01Icon} className="size-3.5" strokeWidth={2} />
          Reset conversation
        </button>
      </div>
    </section>
  );
}

/** Imports, validates, previews, and dispatches one arbitrary conversation. */
function ConversationImportDialog({
  providers,
  provider,
  onProviderChange,
  onAnalyze,
}: {
  providers: ProviderStatus[];
  provider: ProviderId;
  onProviderChange: (provider: ProviderId) => void;
  onAnalyze: (log: ConversationLog, provider: ProviderId) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState<string>();
  const [preview, setPreview] = useState<ConversationLog>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /** Validates current text without starting analysis. */
  function createPreview(nextSource = source, nextFilename = filename) {
    try {
      const log = parseConversationInput(nextSource, { filename: nextFilename });
      setPreview(log);
      setError("");
    } catch (caught) {
      setPreview(undefined);
      setError(
        caught instanceof ConversationImportError
          ? caught.message
          : "This conversation could not be parsed.",
      );
    }
  }

  /** Reads a selected or dropped file as UTF-8, then renders its preview. */
  async function loadFile(file: File) {
    try {
      const text = await file.text();
      setSource(text);
      setFilename(file.name);
      createPreview(text, file.name);
    } catch {
      setError("The selected file could not be read as text.");
    }
  }

  /** Accepts the first file dropped onto the import target. */
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  }

  /** Runs the complete server pipeline and closes only after success. */
  async function submit() {
    if (!preview || submitting) return;
    setSubmitting(true);
    try {
      await onAnalyze(preview, provider);
      setOpen(false);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" className="rounded-full" />}>
        Analyze a log
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="font-heading">Analyze a conversation</DialogTitle>
          <DialogDescription>
            Paste a log or import JSON, CSV, or TXT. You can verify every message before analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <label htmlFor="analysis-provider" className="mb-2 block text-xs font-semibold">
              Provider
            </label>
            <Select
              value={provider}
              onValueChange={(value) => onProviderChange(String(value) as ProviderId)}
            >
              <SelectTrigger
                id="analysis-provider"
                aria-label="Analysis provider"
                className="w-full rounded-xl"
              >
                <SelectValue>
                  {providers.find((item) => item.id === provider)?.name ??
                    "Deterministic demo"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {providers.map((item) => (
                  <SelectItem key={item.id} value={item.id} disabled={!item.available}>
                    {item.name}{item.available ? "" : " — unavailable"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            className="rounded-xl border border-dashed bg-muted/25 p-4 text-center"
          >
            <label htmlFor="conversation-file" className="cursor-pointer text-xs font-semibold">
              Choose a conversation file
            </label>
            <input
              id="conversation-file"
              aria-label="Choose conversation file"
              type="file"
              accept=".json,.csv,.txt,application/json,text/csv,text/plain"
              className="mt-2 block w-full text-xs text-muted-foreground"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadFile(file);
              }}
            />
            <p className="mt-2 text-[10px] text-muted-foreground">or drag and drop it here</p>
          </div>

          <div>
            <label htmlFor="conversation-paste" className="mb-2 block text-xs font-semibold">
              Paste conversation log
            </label>
            <Textarea
              id="conversation-paste"
              aria-label="Paste conversation log"
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setFilename(undefined);
                setPreview(undefined);
                setError("");
              }}
              placeholder="request-17: Prepare the June report.\nfollow-up: Send the raw rows."
              className="min-h-28 resize-y rounded-xl font-mono text-xs"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full rounded-xl"
            onClick={() => createPreview()}
          >
            Preview conversation
          </Button>

          {error && (
            <Alert role="alert" className="border-rose-200 bg-rose-50 text-rose-950">
              <HugeiconsIcon icon={Alert02Icon} className="size-4" strokeWidth={2} />
              <AlertTitle className="text-xs">Check the conversation</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {preview && (
            <section className="rounded-xl border p-3" aria-labelledby="message-preview-title">
              <div className="mb-3 flex items-center justify-between">
                <h3 id="message-preview-title" className="text-xs font-semibold">
                  Message preview
                </h3>
                <span className="text-[10px] text-muted-foreground">
                  {preview.messages.length} messages
                </span>
              </div>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {preview.messages.map((message) => (
                  <div key={message.id} className="rounded-lg bg-muted/50 p-2.5">
                    <p className="font-mono text-[10px] font-semibold">
                      {message.id}
                    </p>
                    <p className="mt-1 text-xs leading-5">{message.text}</p>
                  </div>
                ))}
              </div>
              <Button
                className="mt-3 w-full rounded-xl"
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting ? "Analyzing…" : `Analyze ${preview.messages.length} messages`}
              </Button>
            </section>
          )}

          <p className="text-[10px] text-muted-foreground">
            Samples: <a className="underline" href="/samples/finance-reframe.json" download>Finance reframe</a>
            {" · "}
            <a className="underline" href="/samples/weekly-ambiguity.csv" download>Weekly ambiguity</a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Renders one selectable candidate with confidence, evidence scores, and movement. */
function InterpretationCard({
  item,
  selected,
  onSelect,
}: {
  item: RankedInterpretation;
  selected: boolean;
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
              <h3 className="font-heading text-sm font-semibold leading-5">{item.title}</h3>
              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                {item.summary}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-heading text-xl font-semibold tracking-tight tabular-nums">
                {percentage(item.confidence)}
              </p>
              <p className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">
                confidence
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {SIGNAL_KEYS.map((signal) => (
              <SignalBar key={signal} signal={signal} value={item.signals[signal]} />
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between border-t pt-2.5">
            {movement !== 0 ? (
              <span
                className={cn(
                  "flex items-center gap-1 text-[10px] font-semibold",
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
            ) : (
              <span className="text-[10px] text-muted-foreground">Rank unchanged</span>
            )}
            <span className="font-mono text-[10px] text-muted-foreground">
              weighted score {item.total.toFixed(3)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

/** Middle column: ranked candidates and the immediately visible decision state. */
function RankingPanel({
  result,
  selectedId,
  onSelect,
}: {
  result: RankingResult;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const winner = result.ranking[0];
  const movement = rankMovement(winner);

  return (
    <section className="min-w-0">
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
              Relative confidence compares the weighted evidence for these readings. It
              is not a probability of user intent.
            </TooltipContent>
          </Tooltip>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "h-7 rounded-full px-3 text-[10px] font-semibold",
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
          {result.uncertain ? "Human review" : "Decision ready"}
        </Badge>
      </div>

      {movement > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.055] px-4 py-3 text-xs text-foreground"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <HugeiconsIcon icon={GitCompareIcon} className="size-4" strokeWidth={2} />
          </div>
          <p className="leading-5">
            <span className="font-semibold">Ranking shifted.</span> “{winner.title}” moved
            from #{winner.previousRank} to #1 after the latest message.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {result.ranking.map((item) => (
          <InterpretationCard
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            onSelect={() => onSelect(item.id)}
          />
        ))}
      </div>
    </section>
  );
}

/** Right rail: a faithful explanation assembled from the computed evidence. */
function EvidencePanel({
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

          {result.reframes.length > 0 && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-3.5">
              <div className="flex items-center gap-2 text-violet-900">
                <HugeiconsIcon icon={GitCompareIcon} className="size-4" strokeWidth={2} />
                <p className="text-[11px] font-semibold">Reframe detected</p>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-violet-900/75">
                {result.reframes[0].summary} The newer message is retained in the audit
                trail while the earlier constraint is marked superseded.
              </p>
            </div>
          )}

          {result.uncertain && (
            <Alert className="rounded-xl border-amber-200 bg-amber-50/70 text-amber-950">
              <HugeiconsIcon icon={Alert02Icon} className="size-4" strokeWidth={2} />
              <AlertTitle className="text-xs font-semibold">Ask before acting</AlertTitle>
              <AlertDescription className="text-[11px] leading-4 text-amber-900/80">
                {result.uncertaintyReason} Ask: “Should this be a reusable live view or a
                report delivered each Monday?”
              </AlertDescription>
            </Alert>
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

/** Allows users to choose a documented policy preset or tune each signal weight. */
function WeightSettings({
  weights,
  preset,
  onPresetChange,
  onWeightChange,
  onReset,
}: {
  weights: SignalWeights;
  preset: string;
  onPresetChange: (value: string) => void;
  onWeightChange: (key: SignalKey, value: number) => void;
  onReset: () => void;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="outline" size="sm" className="rounded-full bg-background" />}
      >
        <HugeiconsIcon icon={SlidersHorizontalIcon} className="size-4" strokeWidth={2} />
        Weights
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-heading">Ranking policy</DialogTitle>
          <DialogDescription>
            Tune influence without removing any of the three required evidence axes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div>
            <label className="mb-2 block text-xs font-semibold" htmlFor="weight-profile">
              Preset
            </label>
            <Select value={preset} onValueChange={(value) => onPresetChange(String(value))}>
              <SelectTrigger
                id="weight-profile"
                aria-label="Weight preset"
                className="w-full rounded-xl bg-muted/60"
              >
                <SelectValue>{WEIGHT_PRESETS[preset]?.label ?? "Custom"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(WEIGHT_PRESETS).map(([key, item]) => (
                  <SelectItem key={key} value={key}>
                    {item.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {WEIGHT_PRESETS[preset]?.description ??
                "A custom profile is active. Values are normalised at scoring time."}
            </p>
          </div>

          <WeightStrip weights={weights} />

          <div className="space-y-5">
            {SIGNAL_KEYS.map((key) => (
              <div key={key}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", SIGNAL_META[key].dot)} />
                    <span className="text-xs font-semibold">{SIGNAL_META[key].label}</span>
                  </div>
                  <span className="font-mono text-xs font-semibold tabular-nums">
                    {weights[key]}%
                  </span>
                </div>
                <Slider
                  aria-label={`${SIGNAL_META[key].label} weight`}
                  min={10}
                  max={70}
                  step={5}
                  value={[weights[key]]}
                  onValueChange={(value) => {
                    const nextValue = Array.isArray(value) ? value[0] : value;
                    onWeightChange(key, Number(nextValue));
                  }}
                />
              </div>
            ))}
          </div>

          <Alert className="rounded-xl bg-muted/35">
            <HugeiconsIcon icon={InformationCircleIcon} className="size-4" strokeWidth={2} />
            <AlertTitle className="text-xs">Confidence remains guarded</AlertTitle>
            <AlertDescription className="text-[11px] leading-4">
              Editing weights changes ranking influence, but explicit conflicts remain visible
              and close outcomes still trigger human review.
            </AlertDescription>
          </Alert>

          <Button variant="outline" className="w-full rounded-xl" onClick={onReset}>
            <HugeiconsIcon icon={Refresh01Icon} className="size-4" strokeWidth={2} />
            Restore system defaults
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Explains the adapter boundary and reports locally available providers. */
function ProviderSettings({
  providers,
  selectedProvider,
}: {
  providers: ProviderStatus[];
  selectedProvider: ProviderId;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Provider settings"
          />
        }
      >
        <HugeiconsIcon icon={Settings01Icon} className="size-4" strokeWidth={2} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-heading">Local provider adapters</DialogTitle>
          <DialogDescription>
            Candidate extraction is swappable; scoring and abstention remain application-owned.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 pt-2">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3.5"
            >
              <div
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg",
                  provider.available
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <HugeiconsIcon
                  icon={provider.id === "demo" ? AiBrain03Icon : BotIcon}
                  className="size-4"
                  strokeWidth={2}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold">{provider.name}</p>
                  {provider.id === selectedProvider && (
                    <Badge className="h-5 rounded-full bg-primary/10 text-[9px] text-primary shadow-none">
                      Selected
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {provider.detail}
                </p>
              </div>
              <span
                className={cn(
                  "size-2 rounded-full",
                  provider.available ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
              />
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          The walkthrough uses deterministic fixtures so it works without an account. The
          documented API route can ask an installed Codex CLI—or Codex with Ollama—to
          generate live structured candidates.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Main interactive workbench. State is client-side for a reliable demo, while
 * local CLI candidate generation is exposed independently through an API route.
 */
export function IntentRanker() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [visibleMessageCount, setVisibleMessageCount] = useState(2);
  const [customMessages, setCustomMessages] = useState<ConversationMessage[]>([]);
  const [customMessage, setCustomMessage] = useState("");
  const [weights, setWeights] = useState<SignalWeights>(DEFAULT_WEIGHTS);
  const [weightPreset, setWeightPreset] = useState("explicit");
  const [selectedId, setSelectedId] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [importedLog, setImportedLog] = useState<ConversationLog>();
  const [remoteResult, setRemoteResult] = useState<RankingResult>();
  const [remoteInput, setRemoteInput] = useState<RankingInput>();
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("demo");
  const [analysisSource, setAnalysisSource] = useState<RankSuccessResponse["provider"]>();
  const [analysisError, setAnalysisError] = useState("");
  const [providers, setProviders] = useState<ProviderStatus[]>([
    {
      id: "demo",
      name: "Deterministic demo",
      available: true,
      localInference: true,
      detail: "No account or network required",
    },
  ]);

  const scenario = getScenario(scenarioId);
  const messages = useMemo(
    () =>
      importedLog
        ? [...importedLog.messages, ...customMessages]
        : [...scenario.messages.slice(0, visibleMessageCount), ...customMessages],
    [importedLog, scenario, visibleMessageCount, customMessages],
  );
  const fixtureResult = useMemo(
    () => rankConversation(scenario, messages, weights),
    [scenario, messages, weights],
  );
  const result = useMemo(
    () =>
      remoteInput
        ? rankConversation(remoteInput, messages, weights)
        : remoteResult ?? fixtureResult,
    [fixtureResult, messages, remoteInput, remoteResult, weights],
  );
  const selected =
    result.ranking.find((item) => item.id === selectedId) ?? result.ranking[0];

  useEffect(() => {
    fetch("/api/providers")
      .then((response) => response.json())
      .then((data: { providers?: ProviderStatus[] }) => {
        if (data.providers) setProviders(data.providers);
      })
      .catch(() => {
        // Discovery is optional; the deterministic demo remains usable.
      });
  }, []);

  /** Resets transient state when the walkthrough moves to another fixture. */
  function handleScenarioChange(value: string) {
    setScenarioId(value);
    setVisibleMessageCount(2);
    setCustomMessages([]);
    setCustomMessage("");
    setSelectedId("");
    setImportedLog(undefined);
    setRemoteResult(undefined);
    setRemoteInput(undefined);
    setAnalysisSource(undefined);
    setAnalysisError("");
  }

  /** Reveals the next fixture message after a short, legible processing state. */
  function handleProcessNext() {
    if (visibleMessageCount >= scenario.messages.length || isProcessing) return;
    setIsProcessing(true);
    window.setTimeout(() => {
      setSelectedId("");
      setVisibleMessageCount((count) => count + 1);
      setRemoteResult(undefined);
      setRemoteInput(undefined);
      setAnalysisSource(undefined);
      setIsProcessing(false);
    }, 650);
  }

  /** Appends a non-persistent message and recalculates the ranking. */
  async function handleAddCustomMessage() {
    const text = customMessage.trim();
    if (!text || isProcessing) return;
    const message: ConversationMessage = {
      id: nextMessageId(messages),
      text,
      timestamp: new Date().toISOString(),
    };
    const nextMessages = [...messages, message];
    const log = importedLog
      ? { ...importedLog, messages: nextMessages }
      : scenarioConversationLog(scenario, nextMessages);
    const previousImportedLog = importedLog;
    const previousCustomMessages = customMessages;

    // Commit the new message before waiting for provider latency so the chat
    // remains responsive and accurately shows what is being processed.
    if (importedLog) setImportedLog(log);
    else setCustomMessages((current) => [...current, message]);
    setSelectedId("");
    setCustomMessage("");
    setIsProcessing(true);
    setAnalysisError("");
    try {
      const response = await requestRanking(log, selectedProvider, weights);
      setRemoteResult(response.result);
      setRemoteInput(response.input);
      setAnalysisSource(response.provider);
    } catch (caught) {
      if (previousImportedLog) setImportedLog(previousImportedLog);
      else setCustomMessages(previousCustomMessages);
      setCustomMessage(text);
      setAnalysisError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      setIsProcessing(false);
    }
  }

  /** Restores the selected scenario to its first two fixture messages. */
  function handleReset() {
    setVisibleMessageCount(2);
    setCustomMessages([]);
    setCustomMessage("");
    setSelectedId("");
    setImportedLog(undefined);
    setRemoteResult(undefined);
    setRemoteInput(undefined);
    setAnalysisSource(undefined);
    setAnalysisError("");
  }

  /** Applies a named weighting policy while retaining all three scoring axes. */
  function handlePresetChange(value: string) {
    setWeightPreset(value);
    if (WEIGHT_PRESETS[value]) setWeights(WEIGHT_PRESETS[value].weights);
    setSelectedId("");
  }

  /** Updates one raw weight; the engine normalises all weights before scoring. */
  function handleWeightChange(key: SignalKey, value: number) {
    setWeightPreset("custom");
    setWeights((current) => ({ ...current, [key]: value }));
    setSelectedId("");
  }

  /** Restores the system policy that prioritises explicit constraints. */
  function restoreWeights() {
    setWeights(DEFAULT_WEIGHTS);
    setWeightPreset("explicit");
    setSelectedId("");
  }

  /** Calls the unified endpoint and promotes a validated import into the workbench. */
  async function handleImportedAnalysis(log: ConversationLog, provider: ProviderId) {
    setIsProcessing(true);
    setAnalysisError("");
    try {
      const response = await requestRanking(log, provider, weights);
      setImportedLog(log);
      setCustomMessages([]);
      setRemoteResult(response.result);
      setRemoteInput(response.input);
      setAnalysisSource(response.provider);
      setSelectedId("");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-muted/25">
      <header className="sticky top-0 z-40 border-b bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1720px] items-center gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-foreground text-background shadow-sm">
              <HugeiconsIcon icon={AiBrain03Icon} className="size-[18px]" strokeWidth={2} />
              <span className="absolute right-1 bottom-1 size-1.5 rounded-full bg-primary ring-2 ring-foreground" />
            </div>
            <div className="hidden sm:block">
              <p className="font-heading text-sm font-semibold tracking-tight">Resolve</p>
            </div>
          </div>

          <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />

          <Select
            value={scenarioId}
            onValueChange={(value) => handleScenarioChange(String(value))}
          >
            <SelectTrigger
              aria-label="Demo scenario"
              className="min-w-0 flex-1 rounded-full bg-muted/60 sm:max-w-[330px]"
            >
              <SelectValue>{scenario.shortTitle}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {SCENARIOS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.shortTitle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-2">
            <ConversationImportDialog
              providers={providers}
              provider={selectedProvider}
              onProviderChange={setSelectedProvider}
              onAnalyze={handleImportedAnalysis}
            />
            <WeightSettings
              weights={weights}
              preset={weightPreset}
              onPresetChange={handlePresetChange}
              onWeightChange={handleWeightChange}
              onReset={restoreWeights}
            />
            <ProviderSettings
              providers={providers}
              selectedProvider={selectedProvider}
            />
          </div>
        </div>
      </header>

      <main className="workspace-grid min-h-[calc(100vh-64px)]">
        <div className="mx-auto max-w-[1720px] px-4 py-5 sm:px-6">
          <div className="mb-5">
            <div>
              <h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
                {importedLog ? "Imported conversation" : scenario.title}
              </h1>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                {importedLog
                  ? `${importedLog.messages.length} messages supplied for ${importedLog.userId}.`
                  : scenario.description}
              </p>
              <Badge variant="outline" className="mt-2 rounded-full text-[10px]">
                Analyzed by {analysisSource?.name ?? "Deterministic fixture"}
              </Badge>
            </div>
          </div>

          {analysisError && (
            <Alert role="alert" className="mb-4 border-rose-200 bg-rose-50 text-rose-950">
              <HugeiconsIcon icon={Alert02Icon} className="size-4" strokeWidth={2} />
              <AlertTitle>Analysis could not be completed</AlertTitle>
              <AlertDescription>{analysisError}</AlertDescription>
            </Alert>
          )}

          <div className="grid items-start gap-5 xl:grid-cols-[330px_minmax(460px,1fr)_320px] 2xl:grid-cols-[360px_minmax(560px,1fr)_350px]">
            <ConversationPanel
              messages={messages}
              totalFixtureMessages={importedLog ? messages.length : scenario.messages.length}
              userName={importedLog?.userId ?? scenario.userName}
              userRole={importedLog?.domain?.name ?? scenario.userRole}
              isProcessing={isProcessing}
              customMessage={customMessage}
              onCustomMessageChange={setCustomMessage}
              onAddCustomMessage={handleAddCustomMessage}
              onProcessNext={handleProcessNext}
              onReset={handleReset}
            />
            <RankingPanel result={result} selectedId={selected.id} onSelect={setSelectedId} />
            <EvidencePanel result={result} selected={selected} />
          </div>
        </div>
      </main>
      </div>
    </TooltipProvider>
  );
}
