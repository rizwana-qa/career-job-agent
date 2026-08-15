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
export const CLAUDE_REQUEST_TIMEOUT_MS = 30_000;
export const CLAUDE_MAX_OUTPUT_TOKENS = 1_500;
