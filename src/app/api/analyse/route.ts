/**
 * @file Optional HTTP boundary for structured candidate extraction via Codex.
 *
 * The deterministic walkthrough does not call this route. Live requests are
 * validated here before crossing into the server-only CLI adapter.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { analyseWithCodex } from "@/lib/providers/codex-exec";

// The adapter uses Node child processes and cannot run in the Edge runtime.
export const runtime = "nodejs";

const requestSchema = z.object({
  provider: z.enum(["codex", "codex-oss"]),
  conversation: z.string().min(10).max(20_000),
});

/**
 * Extracts live candidates from a validated JSON request.
 *
 * @param request JSON request containing a provider and conversation.
 * @returns A structured analysis, a concise 400 validation response, or a
 * redacted 502 response when the local provider fails.
 */
export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const analysis = await analyseWithCodex(input.provider, input.conversation);
    return NextResponse.json({ analysis });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Enter a conversation between 10 and 20,000 characters." },
        { status: 400 },
      );
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Send a valid JSON request." },
        { status: 400 },
      );
    }

    // Provider stderr can contain local paths or credential material. Keep the
    // public boundary useful without reflecting those diagnostics.
    return NextResponse.json(
      { error: "The local provider could not complete the analysis." },
      { status: 502 },
    );
  }
}
