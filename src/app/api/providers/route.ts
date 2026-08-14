/**
 * @file Read-only provider discovery endpoint for local CLI adapters.
 *
 * Availability checks inspect executable versions only; they never read or
 * return saved authentication material.
 */

import { NextResponse } from "next/server";

import { getProviderStatuses } from "@/lib/providers/codex-exec";

// Provider discovery uses Node child processes and is always request-time work.
export const runtime = "nodejs";

/** Returns the current availability of deterministic, Codex, and Ollama adapters. */
export async function GET() {
  return NextResponse.json({ providers: await getProviderStatuses() });
}
