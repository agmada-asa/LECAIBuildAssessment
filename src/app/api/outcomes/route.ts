/** @file Authenticated endpoint for accepted and corrected ranking outcomes. */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createConfiguredEmbeddingProvider } from "@/lib/embeddings/config";
import type { PreparableEmbeddingProvider } from "@/lib/embeddings/types";
import { deviceIdFromRequest } from "@/lib/persistence/device";
import { createSQLiteRepository } from "@/lib/persistence/sqlite";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    rankingRunId: z.string().uuid(),
    conversationUserId: z.string().trim().min(1).max(200),
    domainName: z.string().trim().min(1).max(100).optional(),
    decision: z.enum(["accepted", "corrected"]),
    correction: z.string().trim().min(1).max(200).optional(),
    interpretation: z.object({
      id: z.string().trim().min(1).max(200),
      title: z.string().trim().min(1).max(200),
      summary: z.string().trim().min(1).max(2_000),
      semanticTerms: z.array(z.string().trim().min(1)).max(20),
      features: z.array(z.string().trim().min(1)).max(20),
    }),
  })
  .superRefine((value, context) => {
    if (value.decision === "corrected" && !value.correction) {
      context.addIssue({
        code: "custom",
        path: ["correction"],
        message: "Supply the actual intended task for corrected feedback.",
      });
    }
  });

/** Saves one user-owned feedback event as future vector-search history. */
export async function POST(request: Request) {
  const repository = createSQLiteRepository();
  const userId = deviceIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { error: "This browser does not have a valid device identifier." },
      { status: 401 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Send valid JSON." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "The outcome is incomplete or invalid." },
      { status: 400 },
    );
  }

  try {
    const {
      interpretation,
      decision,
      correction,
      conversationUserId,
      domainName,
      rankingRunId,
    } = parsed.data;
    if (!(await repository.rankingRunBelongsToUser(rankingRunId, userId))) {
      return NextResponse.json(
        { error: "That ranking run is not available to this user." },
        { status: 403 },
      );
    }
    const embeddings = createConfiguredEmbeddingProvider();
    const text = `${interpretation.title}. ${interpretation.summary}. ${interpretation.semanticTerms.join(". ")}`;
    const embeddingTexts = correction ? [text, correction] : [text];
    const preparable = embeddings as Partial<PreparableEmbeddingProvider>;
    if (preparable.prepare) await preparable.prepare(embeddingTexts);
    const [embedding, correctionEmbedding] = embeddings.embed(embeddingTexts);
    await repository.storeOutcome({
      id: randomUUID(),
      ownerId: userId,
      userId: conversationUserId,
      domainName,
      sourceRankingRunId: rankingRunId,
      interpretationKey: interpretation.id,
      title: interpretation.title,
      summary: interpretation.summary,
      semanticTerms: interpretation.semanticTerms,
      features: interpretation.features,
      decision,
      accepted: decision === "accepted",
      embedding,
      embeddingModel: embeddings.model.name,
      embeddingVersion: embeddings.model.version,
    });
    if (decision === "corrected" && correction && correctionEmbedding) {
      await repository.storeOutcome({
        id: randomUUID(),
        ownerId: userId,
        userId: conversationUserId,
        domainName,
        sourceRankingRunId: rankingRunId,
        interpretationKey: undefined,
        title: correction,
        summary: correction,
        semanticTerms: [correction],
        features: [],
        decision,
        accepted: true,
        embedding: correctionEmbedding,
        embeddingModel: embeddings.model.name,
        embeddingVersion: embeddings.model.version,
      });
    }
    const resolved = await repository.resolveRankingReview(userId, rankingRunId);
    return NextResponse.json({ saved: true, decision, resolved });
  } catch {
    return NextResponse.json(
      { error: "The outcome could not be saved." },
      { status: 502 },
    );
  }
}
