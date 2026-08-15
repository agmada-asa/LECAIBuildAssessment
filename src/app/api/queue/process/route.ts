/** @file Callable bounded worker endpoint for the durable conversation queue. */

import { NextResponse } from "next/server";
import { z } from "zod";

import { POST as rankConversation } from "@/app/api/rank/route";
import { deviceIdFromRequest } from "@/lib/persistence/device";
import { createSQLiteRepository } from "@/lib/persistence/sqlite";
import type { QueueRankingResult } from "@/lib/persistence/types";
import { processQueuedTasks } from "@/lib/queue/processor";

export const runtime = "nodejs";

const processSchema = z.object({
  limit: z.number().int().min(1).max(25).optional(),
});

/** Runs one worker pass for the requesting owner and returns current task state. */
export async function POST(request: Request) {
  const ownerId = deviceIdFromRequest(request);
  if (!ownerId) {
    return NextResponse.json(
      { error: "This browser does not have a valid device identifier." },
      { status: 401 },
    );
  }
  let json: unknown = {};
  try {
    const text = await request.text();
    if (text) json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Send valid JSON." }, { status: 400 });
  }
  const parsed = processSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "The worker limit must be between 1 and 25." }, { status: 400 });
  }

  const repository = createSQLiteRepository();
  const processed = await processQueuedTasks(
    repository,
    ownerId,
    async (queued, queuedTask) => {
      const rankRequest = new Request("http://localhost/api/rank", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-id": ownerId,
        },
        body: JSON.stringify({
          provider: queued.provider,
          conversation: queued.conversation,
          weights: queued.weights,
          queuedTask,
        }),
      });
      const response = await rankConversation(rankRequest);
      if (!response.ok) {
        const body = (await response.json()) as {
          error?: { message?: string } | string;
        };
        const message = typeof body.error === "string"
          ? body.error
          : body.error?.message;
        throw new Error(message ?? "The ranking request failed without a usable provider error.");
      }
      return (await response.json()) as QueueRankingResult;
    },
    { limit: parsed.data.limit },
  );
  const tasks = await repository.listRankingTasks(ownerId);
  return NextResponse.json({ processed, tasks });
}
