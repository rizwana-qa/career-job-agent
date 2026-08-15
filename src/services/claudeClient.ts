import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";

/**
 * Thin factory around the Anthropic SDK client so callers (the job matching
 * agent, the API route) depend on this function rather than constructing
 * the SDK directly — that's what lets tests inject a mock client instead.
 */
export function createClaudeClient(): Anthropic {
  if (!env.claudeApiKey) {
    throw new Error("CLAUDE_API_KEY is not configured");
  }
  return new Anthropic({ apiKey: env.claudeApiKey });
}

export const CLAUDE_MODEL = "claude-sonnet-5" as const;
// Raised from 30s to 60s, then 60s to 120s (2026-08-15): claude-sonnet-5 runs
// adaptive thinking ON BY DEFAULT, and thinking is required for complete
// output on the larger structured-output calls (resumeTailoringAgent) — see
// the comment on RESUME_TAILORING_MAX_OUTPUT_TOKENS. Thinking adds real
// latency on top of the previous 60s budget, confirmed locally: a tailoring
// call with thinking enabled and a ~10k-input-token prompt took well over
// 60s but comfortably under 120s. Each call still retries on a timeout (see
// MAX_ATTEMPTS in the agents), so worst case for one call is now ~240s
// instead of ~120s. Vercel's own function duration limit is 5 minutes.
export const CLAUDE_REQUEST_TIMEOUT_MS = 120_000;
export const CLAUDE_MAX_OUTPUT_TOKENS = 3_000;
