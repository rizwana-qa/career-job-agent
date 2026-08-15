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
// Raised from 30s to 60s (2026-08-15): two consecutive production runs on
// Vercel timed out specifically on the last step of the per-job pipeline
// (drafting the application message) after tailoring/Evidence Guard/QA all
// succeeded — see docs/DEPLOYMENT.md. Likely network latency between
// Vercel's servers and Anthropic's API rather than a stuck request; each
// call still retries once on a timeout (see MAX_ATTEMPTS in the agents),
// so worst case for one call is now ~120s instead of ~60s. Vercel's own
// function duration limit is 5 minutes, well above that.
export const CLAUDE_REQUEST_TIMEOUT_MS = 60_000;
export const CLAUDE_MAX_OUTPUT_TOKENS = 1_500;
