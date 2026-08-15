/**
 * @file Stateful workflow for the intent-ranking workbench.
 *
 * The hook owns transient conversation state, provider request lifecycles, and
 * local deterministic reweighting. Presentation components remain stateless.
 */

import { useEffect, useRef, useState } from "react";

import type { ConversationLog } from "@/lib/conversations/schema";
import type { ProviderId, ProviderStatus } from "@/lib/providers/types";
import type { RankSuccessResponse } from "@/lib/ranking/api";
import type { RankingResult } from "@/lib/ranking/types";
import { DEVICE_ID_HEADER, getOrCreateDeviceId } from "@/lib/persistence/device";
import type { QueuedRankingTask, QueuedTaskReference } from "@/lib/persistence/types";
import { reweightRankingResult } from "@/lib/ranking/engine";
import { DEFAULT_WEIGHTS, WEIGHT_PRESETS } from "@/lib/ranking/policy";
import type {
  ConversationMessage,
  SignalKey,
  SignalWeights,
} from "@/lib/ranking/types";
import {
  nextMessageId,
  requestRanking,
} from "./model";

type ActiveRequest = {
  id: number;
  controller: AbortController;
};

type ConversationRename = {
  currentConversationId: string;
  nextConversationId: string;
};

/** Restores the truthful provider label persisted with a completed ranking run. */
function restoredProvider(provider: ProviderId): RankSuccessResponse["provider"] {
  return {
    id: provider,
    name:
      provider === "codex"
        ? "Codex CLI"
        : provider === "api"
          ? "OpenAI-compatible API"
          : "Deterministic fallback",
    fallback: provider === "demo",
    notes: "Restored from the latest saved ranking run.",
  };
}

/** Coordinates workbench state and rejects provider responses from obsolete views. */
export function useIntentRanker() {
  const [customMessage, setCustomMessage] = useState("");
  const [weights, setWeights] = useState<SignalWeights>(DEFAULT_WEIGHTS);
  const [weightPreset, setWeightPreset] = useState("explicit");
  const [selectedId, setSelectedId] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingConversationId, setProcessingConversationId] = useState<string>();
  const [isImporting, setIsImporting] = useState(false);
  const [importedLog, setImportedLog] = useState<ConversationLog>();
  const [remoteResult, setRemoteResult] = useState<RankingResult>();
  const [persistence, setPersistence] =
    useState<RankSuccessResponse["persistence"]>();
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("api");
  const [analysisSource, setAnalysisSource] =
    useState<RankSuccessResponse["provider"]>();
  const [analysisError, setAnalysisError] = useState("");
  const [renameError, setRenameError] = useState("");
  const [conversationRename, setConversationRename] = useState<ConversationRename>();
  const [queueRefreshRevision, setQueueRefreshRevision] = useState(0);
  const [outcomeStatus, setOutcomeStatus] = useState("");
  const [acceptedInterpretationId, setAcceptedInterpretationId] = useState("");
  const [isSavingOutcome, setIsSavingOutcome] = useState(false);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const requestSequence = useRef(0);
  const activeRequest = useRef<ActiveRequest | undefined>(undefined);
  const [resultStale, setResultStale] = useState(false);

  const messages = importedLog?.messages ?? [];
  const result = remoteResult;
  const selected = result
    ? result.ranking.find((item) => item.id === selectedId) ?? result.ranking[0]
    : undefined;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/providers", { signal: controller.signal })
      .then((response) => response.json())
      .then((data: { providers?: ProviderStatus[] }) => {
        if (data.providers) {
          const liveProviders = data.providers.filter((provider) => provider.id !== "demo");
          setProviders(liveProviders);
          const readyProvider =
            liveProviders.find((provider) => provider.id === "api" && provider.operational) ??
            liveProviders.find((provider) => provider.operational);
          if (readyProvider) setSelectedProvider(readyProvider.id);
        }
      })
      .catch(() => {
        // Provider discovery failure is presented as an unavailable import path.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/state", {
      headers: { [DEVICE_ID_HEADER]: getOrCreateDeviceId() },
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() : undefined)
      .then((state: { run?: { conversation: ConversationLog; result: RankingResult; provider: ProviderId }; reference?: { id: string; state: RankSuccessResponse["persistence"]["state"] } } | undefined) => {
        if (!state?.run || !state.reference || state.run.provider === "demo") return;
        setImportedLog(state.run.conversation);
        setRemoteResult(state.run.result);
        setSelectedProvider(state.run.provider);
        setAnalysisSource(restoredProvider(state.run.provider));
        setPersistence({ enabled: true, identified: true, rankingRunId: state.reference.id, state: state.reference.state });
      })
      .catch(() => {
        // Starting without saved state remains a valid first-run experience.
      });
    return () => controller.abort();
  }, []);

  useEffect(
    () => () => {
      activeRequest.current?.controller.abort();
    },
    [],
  );

  /** Invalidates provider work before the visible conversation changes. */
  function invalidatePendingWork() {
    requestSequence.current += 1;
    activeRequest.current?.controller.abort();
    activeRequest.current = undefined;
    setIsProcessing(false);
    setProcessingConversationId(undefined);
    setIsImporting(false);
  }

  /** Starts a uniquely identified provider request for one visible conversation. */
  function beginProviderRequest(conversationId: string): ActiveRequest {
    activeRequest.current?.controller.abort();
    const request = {
      id: ++requestSequence.current,
      controller: new AbortController(),
    };
    activeRequest.current = request;
    setIsProcessing(true);
    setProcessingConversationId(conversationId);
    return request;
  }

  /** Returns whether a response still belongs to the visible conversation. */
  function isCurrentRequest(request: ActiveRequest): boolean {
    return activeRequest.current?.id === request.id;
  }

  /** Completes only the request that still owns the processing state. */
  function completeRequest(request: ActiveRequest) {
    if (!isCurrentRequest(request)) return;
    activeRequest.current = undefined;
    setIsProcessing(false);
    setProcessingConversationId(undefined);
  }

  /** Records an imported or changed conversation before direct analysis starts. */
  async function enqueueConversation(
    conversation: ConversationLog,
    provider: ProviderId,
  ): Promise<QueuedTaskReference | undefined> {
    try {
      const response = await fetch("/api/queue", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DEVICE_ID_HEADER]: getOrCreateDeviceId(),
        },
        body: JSON.stringify({ provider, conversation, weights }),
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as { task?: QueuedRankingTask };
      return body.task
        ? { id: body.task.id, revision: body.task.revision }
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** Appends a message and reruns the complete provider pipeline. */
  async function handleAddCustomMessage() {
    const text = customMessage.trim();
    if (!text || isProcessing || !importedLog) return;
    const message: ConversationMessage = {
      id: nextMessageId(messages),
      text,
      timestamp: new Date().toISOString(),
    };
    const nextMessages = [...messages, message];
    const log = { ...importedLog, messages: nextMessages };
    const previousImportedLog = importedLog;
    const request = beginProviderRequest(log.conversationId);

    setImportedLog(log);
    setSelectedId("");
    setCustomMessage("");
    setAnalysisError("");
    setResultStale(false);
    setOutcomeStatus("");
    setAcceptedInterpretationId("");
    try {
      const queuedTask = await enqueueConversation(log, selectedProvider);
      setQueueRefreshRevision((revision) => revision + 1);
      const response = await requestRanking(
        log,
        selectedProvider,
        weights,
        request.controller.signal,
        queuedTask,
      );
      if (!isCurrentRequest(request)) return;
      setRemoteResult(response.result);
      setPersistence(response.persistence);
      setAnalysisSource(response.provider);
      setQueueRefreshRevision((revision) => revision + 1);
    } catch (caught) {
      if (!isCurrentRequest(request)) return;
      setImportedLog(previousImportedLog);
      setCustomMessage(text);
      setAnalysisError(caught instanceof Error ? caught.message : "Analysis failed.");
      setResultStale(true);
      setQueueRefreshRevision((revision) => revision + 1);
    } finally {
      completeRequest(request);
    }
  }

  /** Clears the active imported conversation and archived visible ranking state. */
  function handleReset() {
    invalidatePendingWork();
    setCustomMessage("");
    setSelectedId("");
    setImportedLog(undefined);
    setRemoteResult(undefined);
    setPersistence(undefined);
    setAnalysisSource(undefined);
    setAnalysisError("");
    setRenameError("");
    setConversationRename(undefined);
    setOutcomeStatus("");
    setAcceptedInterpretationId("");
    setIsSavingOutcome(false);
    setResultStale(false);
    fetch("/api/state", {
      method: "DELETE",
      headers: { [DEVICE_ID_HEADER]: getOrCreateDeviceId() },
    }).then(() => {
      setQueueRefreshRevision((revision) => revision + 1);
    }).catch(() => {
      // The visible reset remains useful; a later reload may restore state if archival is unavailable.
    });
  }

  /** Applies a named weighting policy while retaining all three scoring axes. */
  function handlePresetChange(value: string) {
    setWeightPreset(value);
    if (WEIGHT_PRESETS[value]) {
      const nextWeights = WEIGHT_PRESETS[value].weights;
      setWeights(nextWeights);
      setRemoteResult((current) =>
        current ? reweightRankingResult(current, nextWeights) : current,
      );
    }
    setSelectedId("");
  }

  /** Updates one raw weight; the engine normalises all weights before scoring. */
  function handleWeightChange(key: SignalKey, value: number) {
    setWeightPreset("custom");
    const nextWeights = { ...weights, [key]: value };
    setWeights(nextWeights);
    setRemoteResult((result) =>
      result ? reweightRankingResult(result, nextWeights) : result,
    );
    setSelectedId("");
  }

  /** Restores the system policy that prioritises explicit constraints. */
  function restoreWeights() {
    setWeights(DEFAULT_WEIGHTS);
    setWeightPreset("explicit");
    setRemoteResult((current) =>
      current ? reweightRankingResult(current, DEFAULT_WEIGHTS) : current,
    );
    setSelectedId("");
  }

  /** Calls the unified endpoint and promotes a validated import into the workbench. */
  async function handleImportedAnalysis(log: ConversationLog, provider: ProviderId) {
    const request = beginProviderRequest(log.conversationId);
    setIsImporting(true);
    setAnalysisError("");
    setOutcomeStatus("");
    setAcceptedInterpretationId("");
    try {
      const queuedTask = await enqueueConversation(log, provider);
      setQueueRefreshRevision((revision) => revision + 1);
      const response = await requestRanking(
        log,
        provider,
        weights,
        request.controller.signal,
        queuedTask,
      );
      if (!isCurrentRequest(request)) return;
      setImportedLog(log);
      setRemoteResult(response.result);
      setPersistence(response.persistence);
      setAnalysisSource(response.provider);
      setSelectedId("");
      setConversationRename(undefined);
      setQueueRefreshRevision((revision) => revision + 1);
    } catch (caught) {
      if (!isCurrentRequest(request)) return;
      // A replacement import must never leave the previous conversation's
      // ranking visible beneath an error for the newly requested log.
      setImportedLog(log);
      setRemoteResult(undefined);
      setPersistence(undefined);
      setAnalysisSource(undefined);
      setSelectedId("");
      setConversationRename(undefined);
      setAnalysisError(caught instanceof Error ? caught.message : "Analysis failed.");
      setResultStale(false);
      setQueueRefreshRevision((revision) => revision + 1);
    } finally {
      if (isCurrentRequest(request)) setIsImporting(false);
      completeRequest(request);
    }
  }

  /** Saves acceptance or an explicit replacement task as scoped ranking history. */
  async function handleOutcome(
    decision: "accepted" | "corrected",
    correction?: string,
  ) {
    if (!persistence?.rankingRunId || !persistence.identified || !importedLog || !selected) return;
    if (decision === "corrected" && !correction?.trim()) {
      setOutcomeStatus("Describe the actual intended task before saving a correction.");
      return;
    }
    const interpretation = selected;
    setIsSavingOutcome(true);
    setOutcomeStatus("Saving outcome…");
    try {
      const response = await fetch("/api/outcomes", {
        method: "POST",
        headers: { "content-type": "application/json", [DEVICE_ID_HEADER]: getOrCreateDeviceId() },
        body: JSON.stringify({
          rankingRunId: persistence.rankingRunId,
          decision,
          correction: correction?.trim(),
          interpretationId: interpretation.id,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The outcome could not be saved.");
      if (decision === "accepted") {
        setAcceptedInterpretationId(interpretation.id);
        setOutcomeStatus("");
      } else {
        setAcceptedInterpretationId("");
        setOutcomeStatus("Correction saved.");
      }
      setPersistence((current) => current ? { ...current, state: "decided" } : current);
      setQueueRefreshRevision((revision) => revision + 1);
    } catch (caught) {
      setOutcomeStatus(caught instanceof Error ? caught.message : "The outcome could not be saved.");
    } finally {
      setIsSavingOutcome(false);
    }
  }

  /** Optimistically renames the active conversation, then persists every stored snapshot. */
  function handleRenameConversation(name: string) {
    const trimmed = name.trim();
    if (!trimmed || !importedLog || trimmed === importedLog.conversationId) return;
    const previousLog = importedLog;
    const rename = {
      currentConversationId: previousLog.conversationId,
      nextConversationId: trimmed,
    };
    setImportedLog({
      ...previousLog,
      conversationId: trimmed,
    });
    setConversationRename(rename);
    setRenameError("");
    void fetch("/api/queue", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        [DEVICE_ID_HEADER]: getOrCreateDeviceId(),
      },
      body: JSON.stringify(rename),
    })
      .then(async (response) => {
        const body = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "The conversation name could not be saved.");
        setQueueRefreshRevision((revision) => revision + 1);
      })
      .catch((caught: unknown) => {
        setImportedLog((current) =>
          current?.conversationId === trimmed ? previousLog : current,
        );
        setConversationRename(undefined);
        setRenameError(
          caught instanceof Error ? caught.message : "The conversation name could not be saved.",
        );
      });
  }

  /** Restores one completed queue snapshot without rerunning its provider. */
  function handleSelectConversation(task: QueuedRankingTask) {
    if (!task.result) return;
    invalidatePendingWork();
    const restoredWeights = task.request.weights ?? DEFAULT_WEIGHTS;
    setImportedLog(task.request.conversation);
    setCustomMessage("");
    setWeights(restoredWeights);
    setWeightPreset("custom");
    setSelectedId("");
    setRemoteResult(task.result.result);
    setPersistence({ ...task.result.persistence, state: task.state });
    setSelectedProvider(task.result.provider.id);
    setAnalysisSource(task.result.provider);
    setAnalysisError("");
    setRenameError("");
    setConversationRename((current) =>
      current?.nextConversationId === task.request.conversation.conversationId
        ? current
        : undefined,
    );
    setOutcomeStatus("");
    setAcceptedInterpretationId("");
    setIsSavingOutcome(false);
    setResultStale(false);
  }

  return {
    messages,
    result,
    selected,
    customMessage,
    weights,
    weightPreset,
    selectedId,
    isProcessing,
    processingConversationId,
    isImporting,
    importedLog,
    selectedProvider,
    analysisSource,
    analysisError,
    renameError,
    conversationRename,
    queueRefreshRevision,
    providers,
    persistence,
    outcomeStatus,
    acceptedInterpretationId,
    isSavingOutcome,
    resultStale,
    setCustomMessage,
    setSelectedId,
    setSelectedProvider,
    handleAddCustomMessage,
    handleReset,
    handlePresetChange,
    handleWeightChange,
    restoreWeights,
    handleImportedAnalysis,
    handleOutcome,
    handleRenameConversation,
    handleSelectConversation,
  };
}
