/**
 * @file Stateful workflow for the intent-ranking workbench.
 *
 * The hook owns transient conversation state, provider request lifecycles, and
 * local deterministic reweighting. Presentation components remain stateless.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { ConversationLog } from "@/lib/conversations/schema";
import type { ProviderId, ProviderStatus } from "@/lib/providers/types";
import type { RankSuccessResponse } from "@/lib/ranking/api";
import type { RankingResult } from "@/lib/ranking/types";
import { DEVICE_ID_HEADER, getOrCreateDeviceId } from "@/lib/persistence/device";
import { rankConversation, reweightRankingResult } from "@/lib/ranking/engine";
import {
  DEFAULT_WEIGHTS,
  getScenario,
  SCENARIOS,
  WEIGHT_PRESETS,
} from "@/lib/ranking/scenarios";
import type {
  ConversationMessage,
  RankingInput,
  SignalKey,
  SignalWeights,
} from "@/lib/ranking/types";
import {
  nextMessageId,
  requestRanking,
  scenarioConversationLog,
} from "./model";

type ActiveRequest = {
  id: number;
  controller: AbortController;
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
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [visibleMessageCount, setVisibleMessageCount] = useState(2);
  const [customMessages, setCustomMessages] = useState<ConversationMessage[]>([]);
  const [customMessage, setCustomMessage] = useState("");
  const [weights, setWeights] = useState<SignalWeights>(DEFAULT_WEIGHTS);
  const [weightPreset, setWeightPreset] = useState("explicit");
  const [selectedId, setSelectedId] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importedLog, setImportedLog] = useState<ConversationLog>();
  const [remoteInput, setRemoteInput] = useState<RankingInput>();
  const [remotePreviousInput, setRemotePreviousInput] = useState<RankingInput>();
  const [remoteResult, setRemoteResult] = useState<RankingResult>();
  const [persistence, setPersistence] =
    useState<RankSuccessResponse["persistence"]>();
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("demo");
  const [analysisSource, setAnalysisSource] =
    useState<RankSuccessResponse["provider"]>();
  const [analysisError, setAnalysisError] = useState("");
  const [outcomeStatus, setOutcomeStatus] = useState("");
  const [providers, setProviders] = useState<ProviderStatus[]>([
    {
      id: "demo",
      name: "Deterministic demo",
      available: true,
      localInference: true,
      detail: "No account or network required",
    },
  ]);
  const requestSequence = useRef(0);
  const activeRequest = useRef<ActiveRequest | undefined>(undefined);
  const fixtureTimer = useRef<number | undefined>(undefined);

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
      remoteResult ?? (remoteInput
        ? rankConversation(remoteInput, messages, weights, remotePreviousInput)
        : fixtureResult),
    [fixtureResult, messages, remoteInput, remotePreviousInput, remoteResult, weights],
  );
  const selected =
    result.ranking.find((item) => item.id === selectedId) ?? result.ranking[0];

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/providers", { signal: controller.signal })
      .then((response) => response.json())
      .then((data: { providers?: ProviderStatus[] }) => {
        if (data.providers) setProviders(data.providers);
      })
      .catch(() => {
        // Discovery is optional; the deterministic demo remains usable.
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
      .then((state: { run?: { conversation: ConversationLog; input: RankingInput; result: RankingResult; provider: ProviderId }; reference?: { id: string; state: RankSuccessResponse["persistence"]["state"] } } | undefined) => {
        if (!state?.run || !state.reference) return;
        setImportedLog(state.run.conversation);
        setRemoteInput(state.run.input);
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
      if (fixtureTimer.current !== undefined) window.clearTimeout(fixtureTimer.current);
    },
    [],
  );

  /** Invalidates provider and fixture work before the visible conversation changes. */
  function invalidatePendingWork() {
    requestSequence.current += 1;
    activeRequest.current?.controller.abort();
    activeRequest.current = undefined;
    if (fixtureTimer.current !== undefined) {
      window.clearTimeout(fixtureTimer.current);
      fixtureTimer.current = undefined;
    }
    setIsProcessing(false);
    setIsImporting(false);
  }

  /** Starts a uniquely identified provider request, aborting any older request. */
  function beginProviderRequest(): ActiveRequest {
    activeRequest.current?.controller.abort();
    const request = {
      id: ++requestSequence.current,
      controller: new AbortController(),
    };
    activeRequest.current = request;
    setIsProcessing(true);
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
  }

  /** Records an imported or changed conversation before direct analysis starts. */
  async function enqueueConversation(
    conversation: ConversationLog,
    provider: ProviderId,
  ) {
    try {
      const response = await fetch("/api/queue", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DEVICE_ID_HEADER]: getOrCreateDeviceId(),
        },
        body: JSON.stringify({ provider, conversation, weights }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Gives the bounded worker a chance to complete newly queued revisions. */
  function processQueuedConversation() {
    void fetch("/api/queue/process", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [DEVICE_ID_HEADER]: getOrCreateDeviceId(),
      },
      body: JSON.stringify({ limit: 1 }),
    }).catch(() => {
      // The durable pending task remains available for a later worker pass.
    });
  }

  /** Resets transient state when the walkthrough moves to another fixture. */
  function handleScenarioChange(value: string) {
    invalidatePendingWork();
    setScenarioId(value);
    setVisibleMessageCount(2);
    setCustomMessages([]);
    setCustomMessage("");
    setSelectedId("");
    setImportedLog(undefined);
    setRemoteInput(undefined);
    setRemotePreviousInput(undefined);
    setRemoteResult(undefined);
    setPersistence(undefined);
    setAnalysisSource(undefined);
    setAnalysisError("");
    setOutcomeStatus("");
  }

  /** Reveals the next fixture message after a short processing state. */
  function handleProcessNext() {
    if (visibleMessageCount >= scenario.messages.length || isProcessing) return;
    setIsProcessing(true);
    fixtureTimer.current = window.setTimeout(() => {
      const nextMessages = scenario.messages.slice(0, visibleMessageCount + 1);
      fixtureTimer.current = undefined;
      setSelectedId("");
      setVisibleMessageCount((count) => count + 1);
      setRemoteInput(undefined);
      setRemotePreviousInput(undefined);
      setRemoteResult(undefined);
      setAnalysisSource(undefined);
      setIsProcessing(false);
      requestRanking(
        scenarioConversationLog(scenario, nextMessages),
        selectedProvider,
        weights,
        scenario,
      )
        .catch(() => {
          // The deterministic transition remains usable if persistence is unavailable.
        });
    }, 650);
  }

  /** Appends a non-persistent message and reruns the complete provider pipeline. */
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
    const comparisonInput = remoteInput ?? (importedLog ? undefined : scenario);
    const request = beginProviderRequest();

    if (importedLog) setImportedLog(log);
    else setCustomMessages((current) => [...current, message]);
    setSelectedId("");
    setCustomMessage("");
    setAnalysisError("");
    setOutcomeStatus("");
    try {
      const queued = await enqueueConversation(log, selectedProvider);
      const response = await requestRanking(
        log,
        selectedProvider,
        weights,
        comparisonInput,
        request.controller.signal,
      );
      if (!isCurrentRequest(request)) return;
      setRemoteInput(response.input);
      setRemotePreviousInput(comparisonInput);
      setRemoteResult(response.result);
      setPersistence(response.persistence);
      setAnalysisSource(response.provider);
      if (queued) processQueuedConversation();
    } catch (caught) {
      if (!isCurrentRequest(request)) return;
      if (previousImportedLog) setImportedLog(previousImportedLog);
      else setCustomMessages(previousCustomMessages);
      setCustomMessage(text);
      setAnalysisError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      completeRequest(request);
    }
  }

  /** Restores the selected scenario to its first two fixture messages. */
  function handleReset() {
    invalidatePendingWork();
    setVisibleMessageCount(2);
    setCustomMessages([]);
    setCustomMessage("");
    setSelectedId("");
    setImportedLog(undefined);
    setRemoteInput(undefined);
    setRemotePreviousInput(undefined);
    setRemoteResult(undefined);
    setPersistence(undefined);
    setAnalysisSource(undefined);
    setAnalysisError("");
    fetch("/api/state", {
      method: "DELETE",
      headers: { [DEVICE_ID_HEADER]: getOrCreateDeviceId() },
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
    const request = beginProviderRequest();
    setIsImporting(true);
    setAnalysisError("");
    try {
      const queued = await enqueueConversation(log, provider);
      const response = await requestRanking(
        log,
        provider,
        weights,
        undefined,
        request.controller.signal,
      );
      if (!isCurrentRequest(request)) return;
      setImportedLog(log);
      setCustomMessages([]);
      setRemoteInput(response.input);
      setRemotePreviousInput(undefined);
      setRemoteResult(response.result);
      setPersistence(response.persistence);
      setAnalysisSource(response.provider);
      setSelectedId("");
      if (queued) processQueuedConversation();
    } catch (caught) {
      if (!isCurrentRequest(request)) return;
      setAnalysisError(caught instanceof Error ? caught.message : "Analysis failed.");
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
    if (!persistence?.rankingRunId || !persistence.identified || !importedLog) return;
    if (decision === "corrected" && !correction?.trim()) {
      setOutcomeStatus("Describe the actual intended task before saving a correction.");
      return;
    }
    setOutcomeStatus("Saving outcome…");
    try {
      const response = await fetch("/api/outcomes", {
        method: "POST",
        headers: { "content-type": "application/json", [DEVICE_ID_HEADER]: getOrCreateDeviceId() },
        body: JSON.stringify({
          rankingRunId: persistence.rankingRunId,
          domainName: importedLog.domain?.name,
          conversationUserId: importedLog.userId,
          decision,
          correction: correction?.trim(),
          interpretation: {
            id: selected.id,
            title: selected.title,
            summary: selected.summary,
            semanticTerms: selected.semanticTerms,
            features: selected.features,
          },
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The outcome could not be saved.");
      setOutcomeStatus(
        decision === "accepted" ? "Interpretation accepted." : "Correction saved.",
      );
    } catch (caught) {
      setOutcomeStatus(caught instanceof Error ? caught.message : "The outcome could not be saved.");
    }
  }

  return {
    scenarioId,
    scenario,
    messages,
    result,
    selected,
    customMessage,
    weights,
    weightPreset,
    selectedId,
    isProcessing,
    isImporting,
    importedLog,
    selectedProvider,
    analysisSource,
    analysisError,
    providers,
    persistence,
    outcomeStatus,
    setCustomMessage,
    setSelectedId,
    setSelectedProvider,
    handleScenarioChange,
    handleProcessNext,
    handleAddCustomMessage,
    handleReset,
    handlePresetChange,
    handleWeightChange,
    restoreWeights,
    handleImportedAnalysis,
    handleOutcome,
  };
}
