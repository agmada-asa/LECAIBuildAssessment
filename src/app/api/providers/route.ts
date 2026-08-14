/**
 * @file Read-only discovery for local and server-configured analysis providers.
 *
 * Availability checks inspect executable versions only; they never read or
 * return saved authentication material.
 */

import { NextResponse } from "next/server";

import { getProviderStatuses } from "@/lib/providers/codex-exec";

// Provider discovery uses Node child processes and is always request-time work.
export const runtime = "nodejs";

/** Returns deterministic, Codex CLI, and OpenAI-compatible API availability. */
export async function GET() {
  return NextResponse.json({ providers: await getProviderStatuses() });
}
