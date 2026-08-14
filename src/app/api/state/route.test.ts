/** @file Device isolation tests for restoring the latest SQLite snapshot. */

import { describe, expect, it, vi } from "vitest";

const { archiveLatestRankingState, latestRankingState } = vi.hoisted(() => ({
  archiveLatestRankingState: vi.fn(),
  latestRankingState: vi.fn(),
}));

vi.mock("@/lib/persistence/sqlite", () => ({
  createSQLiteRepository: () => ({ archiveLatestRankingState, latestRankingState }),
}));

import { DELETE, GET } from "./route";

describe("GET /api/state", () => {
  it("loads state only for the supplied browser profile", async () => {
    latestRankingState.mockResolvedValue({ reference: { id: "run-1" }, run: { provider: "demo" } });
    const response = await GET(new Request("http://localhost/api/state", {
      headers: { "x-device-id": "00000000-0000-4000-8000-000000000001" },
    }));

    expect(response.status).toBe(200);
    expect(latestRankingState).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
  });

  it("rejects malformed identifiers", async () => {
    const response = await GET(new Request("http://localhost/api/state", {
      headers: { "x-device-id": "fingerprinted-device" },
    }));

    expect(response.status).toBe(400);
  });

  it("archives the latest state when the workbench is reset", async () => {
    archiveLatestRankingState.mockResolvedValue(true);
    const response = await DELETE(new Request("http://localhost/api/state", {
      method: "DELETE",
      headers: { "x-device-id": "00000000-0000-4000-8000-000000000001" },
    }));

    expect(response.status).toBe(200);
    expect(archiveLatestRankingState).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
  });
});
