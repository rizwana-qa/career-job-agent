import type { Request, Response } from "express";
import { env } from "../../config/env.js";

/**
 * Shared bearer-auth check for every CAREER_AGENT_API_KEY-protected route
 * (POST /career/run, POST /career/discover-match, POST /career/process-job).
 * Extracted from careerRun.ts (Phase 8.2) so the granular endpoints reuse the
 * exact same auth logic instead of a second, parallel implementation.
 *
 * Writes the appropriate error response and returns false if unauthenticated
 * (caller must `return` immediately); returns true if the request may
 * proceed. Never logs or echoes the configured or provided key.
 */
export function authenticateCareerAgentRequest(req: Request, res: Response, apiKeyOverride?: string): boolean {
  const configuredApiKey = apiKeyOverride ?? env.careerAgentApiKey;
  if (!configuredApiKey) {
    res.status(503).json({ error: "Orchestration API is not configured" });
    return false;
  }

  const authHeader = req.header("Authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  const providedKey = match?.[1];

  if (!providedKey) {
    res.status(401).json({ error: "Missing API key" });
    return false;
  }
  if (providedKey !== configuredApiKey) {
    res.status(401).json({ error: "Invalid API key" });
    return false;
  }

  return true;
}
