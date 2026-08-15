"use client";

/** @file Composes the intent-ranking workbench from focused workflow and panel modules. */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConversationPanel } from "./intent-ranker/conversation-panel";
import { EvidencePanel } from "./intent-ranker/evidence-panel";
import { ConversationImportDialog } from "./intent-ranker/import-dialog";
import { StartConversationDialog } from "./intent-ranker/start-dialog";
import { RankingPanel } from "./intent-ranker/ranking-panel";
import { TaskSidebar } from "./intent-ranker/task-sidebar";
import { ProviderSettings, WeightSettings } from "./intent-ranker/settings-dialogs";
import { useIntentRanker } from "./intent-ranker/use-intent-ranker";

/** Main arbitrary-conversation analysis workbench. */
export function IntentRanker() {
  const workbench = useIntentRanker();
  const result = workbench.result;
  const selected = workbench.selected;
  const analysis = result && selected ? { result, selected } : undefined;
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");

  /** Commits the inline edited conversation title. */
  function saveTitle() {
    if (editedTitle.trim()) {
      workbench.handleRenameConversation(editedTitle.trim());
    }
    setIsEditingTitle(false);
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-muted/25">
        <header className="sticky top-0 z-40 border-b bg-background/92 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1720px] items-center gap-4 px-4 sm:px-6">
            <div className="hidden min-w-0 items-center sm:flex">
              <p className="font-heading text-lg font-bold tracking-tight text-foreground">Resolve</p>
            </div>

            <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground sm:text-foreground font-medium">
              {workbench.importedLog?.conversationId ?? "Conversation ranking"}
            </p>

            <div className="ml-auto flex items-center gap-2">
              <StartConversationDialog
                providers={workbench.providers}
                provider={workbench.selectedProvider}
                onProviderChange={workbench.setSelectedProvider}
                onStart={workbench.handleImportedAnalysis}
              />
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

        <div className="flex min-h-[calc(100vh-64px)]">
          <TaskSidebar
            activeConversationId={workbench.importedLog?.conversationId}
            processingConversationId={workbench.processingConversationId}
            renamedConversation={workbench.conversationRename}
            refreshKey={`${workbench.importedLog?.conversationId ?? "empty"}:${workbench.persistence?.state ?? "none"}:${workbench.queueRefreshRevision}`}
            onSelectConversation={workbench.handleSelectConversation}
          />
          <main
            aria-busy={workbench.isImporting}
            className="workspace-grid min-w-0 flex-1 pl-14 lg:pl-0"
          >
          <div className="mx-auto max-w-[1720px] px-4 py-5 sm:px-6">
            {workbench.analysisError && (
              <Alert role="alert" className="mb-4 border-rose-200 bg-rose-50 text-rose-950">
                <HugeiconsIcon icon={Alert02Icon} className="size-4" strokeWidth={2} />
                <AlertTitle>Analysis could not be completed</AlertTitle>
                <AlertDescription>
                  {workbench.analysisError}{" "}
                  {analysis && workbench.resultStale
                    ? "The last successful ranking remains visible because the follow-up was not applied."
                    : workbench.importedLog
                      ? `No ranking is shown for ${workbench.importedLog.conversationId}.`
                      : "No ranking is shown."}{" "}
                  Choose “Start a conversation” or “Analyze a log” to retry.
                </AlertDescription>
              </Alert>
            )}
            {workbench.renameError && (
              <Alert role="alert" className="mb-4 border-rose-200 bg-rose-50 text-rose-950">
                <HugeiconsIcon icon={Alert02Icon} className="size-4" strokeWidth={2} />
                <AlertTitle>Conversation name was not saved</AlertTitle>
                <AlertDescription>{workbench.renameError}</AlertDescription>
              </Alert>
            )}

            {(!workbench.importedLog || !analysis) && !workbench.isImporting ? (
              <section className="mx-auto flex min-h-[calc(100vh-140px)] max-w-2xl flex-col items-center justify-center text-center">
                <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
                  Rank an ambiguous conversation
                </h1>
                <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                  Start a new conversation or import a log (JSON, CSV, or TXT) to compare grounded interpretations and route uncertain work for review.
                </p>
                <p className="mt-4 text-sm font-medium">Choose “Start a conversation” or “Analyze a log” to begin.</p>
              </section>
            ) : workbench.isImporting ? (
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
            ) : analysis ? (
              <>
                <div className="mb-5">
                  {isEditingTitle ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveTitle();
                      }}
                      className="flex items-center gap-2 max-w-md"
                    >
                      <Input
                        aria-label="Edit conversation name"
                        value={editedTitle}
                        onChange={(event) => setEditedTitle(event.target.value)}
                        placeholder="Conversation name"
                        className="h-8 rounded-xl text-sm font-medium"
                        autoFocus
                      />
                      <Button size="xs" type="submit" aria-label="Save name">
                        Save
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        type="button"
                        onClick={() => setIsEditingTitle(false)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
                        {workbench.importedLog?.conversationId ?? "Analyzing conversation"}
                      </h1>
                      {workbench.importedLog && (
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label="Rename conversation"
                          onClick={() => {
                            setEditedTitle(workbench.importedLog?.conversationId ?? "");
                            setIsEditingTitle(true);
                          }}
                          className="rounded-full text-xs text-muted-foreground hover:text-foreground"
                        >
                          Rename
                        </Button>
                      )}
                    </div>
                  )}
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                    {workbench.importedLog
                      ? `${workbench.importedLog.messages.length} messages supplied for ${workbench.importedLog.userId}.`
                      : "The imported log is being analyzed."}
                  </p>
                </div>

                <div className="grid items-start gap-5 xl:grid-cols-[330px_minmax(460px,1fr)_320px] 2xl:grid-cols-[360px_minmax(560px,1fr)_350px]">
                  <ConversationPanel
                    messages={workbench.messages}
                    userName={workbench.importedLog?.userId ?? "Unknown user"}
                    userRole={workbench.importedLog?.domain?.name ?? "Domain not supplied"}
                    isProcessing={workbench.isProcessing}
                    customMessage={workbench.customMessage}
                    onCustomMessageChange={workbench.setCustomMessage}
                    onAddCustomMessage={workbench.handleAddCustomMessage}
                    onReset={workbench.handleReset}
                  />
                  <RankingPanel
                    result={analysis.result}
                    selectedId={analysis.selected.id}
                    acceptedInterpretationId={workbench.acceptedInterpretationId}
                    onSelect={workbench.setSelectedId}
                  />
                  <EvidencePanel
                    result={analysis.result}
                    selected={analysis.selected}
                    canSaveOutcome={
                      !workbench.resultStale &&
                      Boolean(
                        workbench.persistence?.identified &&
                          workbench.persistence.rankingRunId,
                      )
                    }
                    canAcceptOutcome={
                      (analysis.selected.kind ?? "task") === "task" &&
                      analysis.selected.valid !== false
                    }
                    outcomeStatus={workbench.outcomeStatus}
                    acceptedInterpretationId={workbench.acceptedInterpretationId}
                    isSavingOutcome={workbench.isSavingOutcome}
                    onOutcome={workbench.handleOutcome}
                  />
                </div>

                <footer className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 pt-4 text-xs text-muted-foreground">
                  {workbench.analysisSource && (
                    <>
                      <span>Analyzed by {workbench.analysisSource.name}</span>
                      <span aria-hidden="true">•</span>
                    </>
                  )}
                  {workbench.persistence?.state && (
                    <>
                      <span>State: {workbench.persistence.state.replace("_", " ")}</span>
                      <span aria-hidden="true">•</span>
                    </>
                  )}
                  <span>
                    {analysis.result.semanticModel.name}@{analysis.result.semanticModel.revision}
                  </span>
                </footer>
              </>
            ) : null}
          </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
