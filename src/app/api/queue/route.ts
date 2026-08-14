/** @file Owner-scoped HTTP boundary for durable conversational ranking tasks. */

import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationLogSchema } from "@/lib/conversations/schema";
import { deviceIdFromRequest } from "@/lib/persistence/device";
import { createSQLiteRepository } from "@/lib/persistence/sqlite";

export const runtime = "nodejs";

const weightsSchema = z.object({
  semantic: z.number().min(0).max(100),
  constraints: z.number().min(0).max(100),
  history: z.number().min(0).max(100),
});

const enqueueSchema = z.object({
  provider: z.enum(["demo", "codex", "api"]),
  conversation: conversationLogSchema,
  weights: weightsSchema.optional(),
});

const retrySchema = z.object({ taskId: z.string().trim().min(1).max(200) });
const renameSchema = z.object({
  currentConversationId: z.string().trim().min(1).max(200),
  nextConversationId: z.string().trim().min(1).max(200),
});

/** Returns an authorization response without leaking whether tasks exist. */
function missingOwnerResponse(): NextResponse {
  return NextResponse.json(
    { error: "This browser does not have a valid device identifier." },
    { status: 401 },
  );
}

/** Lists every inspectable task owned by the requesting browser profile. */
export async function GET(request: Request) {
  const ownerId = deviceIdFromRequest(request);
  if (!ownerId) return missingOwnerResponse();
  const repository = createSQLiteRepository();
  await repository.reconcilePendingRankingTasks(ownerId);
  const tasks = await repository.listRankingTasks(ownerId);
  return NextResponse.json({ tasks });
}

/** Enqueues a new or changed canonical conversation snapshot. */
export async function POST(request: Request) {
  const ownerId = deviceIdFromRequest(request);
  if (!ownerId) return missingOwnerResponse();
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Send valid JSON." }, { status: 400 });
  }
  const parsed = enqueueSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "The queued conversation is incomplete or invalid." },
      { status: 400 },
    );
  }
  const task = await createSQLiteRepository().enqueueRankingTask({
    ownerId,
    ...parsed.data,
  });
  return NextResponse.json({ task }, { status: 202 });
}

/** Makes one owned failed task eligible for another bounded worker pass. */
export async function PATCH(request: Request) {
  const ownerId = deviceIdFromRequest(request);
  if (!ownerId) return missingOwnerResponse();
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Send valid JSON." }, { status: 400 });
  }
  const rename = renameSchema.safeParse(json);
  if (rename.success) {
    const renamed = await createSQLiteRepository().renameConversation(
      ownerId,
      rename.data.currentConversationId,
      rename.data.nextConversationId,
    );
    return renamed
      ? NextResponse.json({ renamed: true })
      : NextResponse.json(
          { error: "That conversation is unavailable or the new name is already in use." },
          { status: 409 },
        );
  }
  const retry = retrySchema.safeParse(json);
  if (!retry.success) {
    return NextResponse.json({ error: "Provide a valid task id or conversation rename." }, { status: 400 });
  }
  const retried = await createSQLiteRepository().retryRankingTask(ownerId, retry.data.taskId);
  return retried
    ? NextResponse.json({ retried: true })
    : NextResponse.json(
        { error: "That failed task is not available to retry." },
        { status: 409 },
      );
}
