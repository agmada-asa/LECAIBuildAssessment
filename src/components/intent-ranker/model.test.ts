/** @file Request-boundary regressions for the intent-ranking workbench. */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_WEIGHTS } from "@/lib/ranking/policy";
import { ANALYSIS_REQUEST_TIMEOUT_MS, requestRanking } from "./model";

describe("requestRanking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("stops waiting and reports a useful error after the UI analysis deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      ),
    );
    const analysis = requestRanking(
      {
        conversationId: "slow-analysis",
        userId: "reviewer",
        messages: [{
          id: "M1",
          text: "Prepare the report.",
          timestamp: "2026-08-15T08:00:00.000Z",
        }],
        acceptedOutcomes: [],
      },
      "api",
      DEFAULT_WEIGHTS,
    );
    const rejection = expect(analysis).rejects.toThrow(
      "Analysis took longer than 90 seconds",
    );

    await vi.advanceTimersByTimeAsync(ANALYSIS_REQUEST_TIMEOUT_MS);

    await rejection;
  });
});
