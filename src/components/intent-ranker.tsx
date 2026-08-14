"use client";

/** @file Composes the intent-ranking workbench from focused workflow and panel modules. */

import { HugeiconsIcon } from "@hugeicons/react";
import { AiBrain03Icon, Alert02Icon } from "@hugeicons/core-free-icons";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConversationPanel } from "./intent-ranker/conversation-panel";
import { EvidencePanel } from "./intent-ranker/evidence-panel";
import { ConversationImportDialog } from "./intent-ranker/import-dialog";
import { RankingPanel } from "./intent-ranker/ranking-panel";
import { QueueDialog } from "./intent-ranker/queue-dialog";
import { ProviderSettings, WeightSettings } from "./intent-ranker/settings-dialogs";
import { useIntentRanker } from "./intent-ranker/use-intent-ranker";

/** Main arbitrary-conversation analysis workbench. */
export function IntentRanker() {
  const workbench = useIntentRanker();

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-muted/25">
        <header className="sticky top-0 z-40 border-b bg-background/92 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1720px] items-center gap-4 px-4 sm:px-6">
            <div className="hidden min-w-0 items-center gap-3 sm:flex">
              <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-foreground text-background shadow-sm">
                <HugeiconsIcon icon={AiBrain03Icon} className="size-[18px]" strokeWidth={2} />
                <span className="absolute right-1 bottom-1 size-1.5 rounded-full bg-primary ring-2 ring-foreground" />
              </div>
              <div className="hidden sm:block">
                <p className="font-heading text-sm font-semibold tracking-tight">Resolve</p>
              </div>
            </div>

            <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />

            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {workbench.importedLog?.conversationId ?? "Conversation ranking"}
            </p>

            <div className="ml-auto flex items-center gap-2">
              <QueueDialog />
              <ConversationImportDialog
                providers={workbench.providers}
                provider={workbench.selectedProvider}
                onProviderChange={workbench.setSelectedProvider}
                onAnalyze={workbench.handleImportedAnalysis}
              />
              <div className="hidden items-center gap-2 sm:flex">
                <WeightSettings
                  weights={workbench.weights}
                  preset={workbench.weightPreset}
                  onPresetChange={workbench.handlePresetChange}
                  onWeightChange={workbench.handleWeightChange}
                  onReset={workbench.restoreWeights}
                />
                <ProviderSettings
                  providers={workbench.providers}
                  selectedProvider={workbench.selectedProvider}
                />
              </div>
            </div>
          </div>
        </header>

        <main
          aria-busy={workbench.isImporting}
          className="workspace-grid min-h-[calc(100vh-64px)]"
        >
          <div className="mx-auto max-w-[1720px] px-4 py-5 sm:px-6">
            {!workbench.importedLog && !workbench.isImporting ? (
              <section className="mx-auto flex min-h-[calc(100vh-140px)] max-w-2xl flex-col items-center justify-center text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-foreground text-background">
                  <HugeiconsIcon icon={AiBrain03Icon} className="size-6" strokeWidth={2} />
                </div>
                <h1 className="mt-5 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
                  Rank an ambiguous conversation
                </h1>
                <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                  Import JSON, CSV, or TXT to compare grounded interpretations and route uncertain work for review.
                </p>
                <p className="mt-4 text-sm font-medium">Choose “Analyze a log” to begin.</p>
              </section>
            ) : <>
            <div className="mb-5">
              <h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
                {workbench.importedLog?.conversationId ?? "Analyzing conversation"}
              </h1>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                {workbench.importedLog
                  ? `${workbench.importedLog.messages.length} messages supplied for ${workbench.importedLog.userId}.`
                  : "The imported log is being analyzed."}
              </p>
              {workbench.analysisSource && <Badge variant="outline" className="mt-2 rounded-full text-xs">
                Analyzed by {workbench.analysisSource.name}
              </Badge>}
              {workbench.persistence?.state && (
                <Badge variant="outline" className="mt-2 ml-2 rounded-full text-xs">
                  State: {workbench.persistence.state.replace("_", " ")}
                </Badge>
              )}
              <Badge variant="outline" className="mt-2 ml-2 rounded-full text-xs">
                {workbench.result.semanticModel.name}@{workbench.result.semanticModel.revision}
              </Badge>
            </div>

            {workbench.analysisError && (
              <Alert role="alert" className="mb-4 border-rose-200 bg-rose-50 text-rose-950">
                <HugeiconsIcon icon={Alert02Icon} className="size-4" strokeWidth={2} />
                <AlertTitle>Analysis could not be completed</AlertTitle>
                <AlertDescription>
                  {workbench.analysisError} Choose “Analyze a log” to retry with the current log.
                </AlertDescription>
              </Alert>
            )}

            {workbench.isImporting ? (
              <section
                role="status"
                aria-label="Analysis in progress"
                aria-live="polite"
                className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border bg-card px-6 text-center shadow-sm"
              >
                <div className="size-10 animate-spin rounded-full border-2 border-muted border-t-primary" />
                <h2 className="mt-5 font-heading text-base font-semibold">
                  Analyzing conversation…
                </h2>
                <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                  The ranking and supporting evidence will appear here when the analysis is ready.
                </p>
                <div className="mt-5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                </div>
              </section>
            ) : (
            <div className="grid items-start gap-5 xl:grid-cols-[330px_minmax(460px,1fr)_320px] 2xl:grid-cols-[360px_minmax(560px,1fr)_350px]">
              <ConversationPanel
                messages={workbench.messages}
                totalFixtureMessages={workbench.messages.length}
                userName={workbench.importedLog?.userId ?? "Unknown user"}
                userRole={workbench.importedLog?.domain?.name ?? "Domain not supplied"}
                isProcessing={workbench.isProcessing}
                customMessage={workbench.customMessage}
                onCustomMessageChange={workbench.setCustomMessage}
                onAddCustomMessage={workbench.handleAddCustomMessage}
                onProcessNext={() => undefined}
                onReset={workbench.handleReset}
              />
              <RankingPanel
                result={workbench.result}
                selectedId={workbench.selected.id}
                onSelect={workbench.setSelectedId}
              />
              <EvidencePanel
                result={workbench.result}
                selected={workbench.selected}
                canSaveOutcome={!workbench.resultStale && Boolean(
                  workbench.persistence?.identified &&
                    workbench.persistence.rankingRunId,
                )}
                outcomeStatus={workbench.outcomeStatus}
                onOutcome={workbench.handleOutcome}
              />
            </div>
            )}
            </>}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
