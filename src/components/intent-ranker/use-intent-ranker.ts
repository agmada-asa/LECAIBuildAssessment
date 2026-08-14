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
import { rankConversation } from "@/lib/ranking/engine";
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
  const [importedLog, setImportedLog] = useState<ConversationLog>();
  const [remoteInput, setRemoteInput] = useState<RankingInput>();
  const [remotePreviousInput, setRemotePreviousInput] = useState<RankingInput>();
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("demo");
  const [analysisSource, setAnalysisSource] =
    useState<RankSuccessResponse["provider"]>();
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
      remoteInput
        ? rankConversation(remoteInput, messages, weights, remotePreviousInput)
        : fixtureResult,
    [fixtureResult, messages, remoteInput, remotePreviousInput, weights],
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
    setAnalysisSource(undefined);
    setAnalysisError("");
  }

  /** Reveals the next fixture message after a short processing state. */
  function handleProcessNext() {
    if (visibleMessageCount >= scenario.messages.length || isProcessing) return;
    setIsProcessing(true);
    fixtureTimer.current = window.setTimeout(() => {
      fixtureTimer.current = undefined;
      setSelectedId("");
      setVisibleMessageCount((count) => count + 1);
      setRemoteInput(undefined);
      setRemotePreviousInput(undefined);
      setAnalysisSource(undefined);
      setIsProcessing(false);
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
    try {
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
      setAnalysisSource(response.provider);
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
    const request = beginProviderRequest();
    setAnalysisError("");
    try {
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
      setAnalysisSource(response.provider);
      setSelectedId("");
    } finally {
      completeRequest(request);
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
    importedLog,
    selectedProvider,
    analysisSource,
    analysisError,
    providers,
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
  };
}
