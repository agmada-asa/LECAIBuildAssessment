/** @file Restores the latest SQLite ranking snapshot for a browser profile. */

import { NextResponse } from "next/server";

import { deviceIdFromRequest } from "@/lib/persistence/device";
import { createSQLiteRepository } from "@/lib/persistence/sqlite";

export const runtime = "nodejs";

/** Returns the latest device-owned state, or an empty response on first use. */
export async function GET(request: Request) {
  const deviceId = deviceIdFromRequest(request);
  if (!deviceId) return NextResponse.json({ error: "Invalid device identifier." }, { status: 400 });
  const state = await createSQLiteRepository().latestRankingState(deviceId);
  return state ? NextResponse.json(state) : new NextResponse(null, { status: 204 });
}

/** Archives the newest snapshot so a cleared workbench stays cleared on reload. */
export async function DELETE(request: Request) {
  const ownerId = deviceIdFromRequest(request);
  if (!ownerId) return NextResponse.json({ error: "Invalid device identifier." }, { status: 400 });
  const archived = await createSQLiteRepository().archiveLatestRankingState(ownerId);
  return NextResponse.json({ archived });
}
