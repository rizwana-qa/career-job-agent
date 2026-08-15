import { Router } from "express";
import type Anthropic from "@anthropic-ai/sdk";
import { createClaudeClient } from "../../services/claudeClient.js";
import { createRemotiveJobSource } from "../../jobSources/remotiveJobSource.js";
import { createWhatsAppProvider } from "../../notifications/whatsappProvider.js";
import type { JobSource } from "../../jobSources/jobSource.js";
import type { NotificationProvider } from "../../notifications/notificationProvider.js";
import {
  InMemoryIdempotencyStore,
  runCareerPipeline,
  type IdempotencyStore
} from "../../services/careerOrchestrationService.js";
import { env } from "../../config/env.js";
import { ClaudeNotConfiguredError, InvalidOrchestrationInputError, toSafeErrorMessage } from "../../utils/errors.js";

export interface CareerRunRouterDependencies {
  jobSource?: JobSource;
  claudeClient?: Anthropic;
  notificationProvider?: NotificationProvider;
  idempotencyStore?: IdempotencyStore;
  /** Overrides env.careerAgentApiKey — mainly for tests. */
  apiKey?: string;
}

let defaultJobSource: JobSource | undefined;
function getDefaultJobSource(): JobSource {
  if (!defaultJobSource) {
    defaultJobSource = createRemotiveJobSource();
  }
  return defaultJobSource;
}

let defaultIdempotencyStore: IdempotencyStore | undefined;
function getDefaultIdempotencyStore(): IdempotencyStore {
  if (!defaultIdempotencyStore) {
    defaultIdempotencyStore = new InMemoryIdempotencyStore();
  }
  return defaultIdempotencyStore;
}

/** Structured, safe-only logger (Phase 8 spec §11) — runId/stage/counts/duration/status/errorType, never content. */
function safeLog(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ source: "career-agent", ...event }));
}

/**
 * POST /career/run — the n8n orchestration entry point. Requires
 * `Authorization: Bearer <CAREER_AGENT_API_KEY>` (see docs/SECURITY.md).
 * Still localhost-appropriate by default like every other route in this
 * project, but is the first endpoint with its own authentication layer —
 * n8n's calls must include the bearer token.
 */
export function createCareerRunRouter(deps: CareerRunRouterDependencies = {}): Router {
  const router = Router();

  router.post("/career/run", async (req, res) => {
    const configuredApiKey = deps.apiKey ?? env.careerAgentApiKey;
    if (!configuredApiKey) {
      res.status(503).json({ error: "Orchestration API is not configured" });
      return;
    }

    const authHeader = req.header("Authorization") ?? "";
    const match = authHeader.match(/^Bearer (.+)$/);
    const providedKey = match?.[1];

    if (!providedKey) {
      res.status(401).json({ error: "Missing API key" });
      return;
    }
    if (providedKey !== configuredApiKey) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    let claudeClient: Anthropic | undefined = deps.claudeClient;
    if (!claudeClient) {
      try {
        claudeClient = createClaudeClient();
      } catch {
        claudeClient = undefined;
      }
    }

    const idempotencyKeyHeader = req.header("Idempotency-Key");

    try {
      const result = await runCareerPipeline(
        { options: req.body ?? {}, idempotencyKey: idempotencyKeyHeader },
        {
          jobSource: deps.jobSource ?? getDefaultJobSource(),
          claudeClient,
          notificationProvider: deps.notificationProvider ?? createWhatsAppProvider(),
          idempotencyStore: deps.idempotencyStore ?? getDefaultIdempotencyStore(),
          log: safeLog
        }
      );
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof InvalidOrchestrationInputError) {
        res.status(400).json({ error: "Invalid request body", details: error.issues });
        return;
      }
      if (error instanceof ClaudeNotConfiguredError) {
        res.status(503).json({ error: "Claude API is not configured" });
        return;
      }
      console.error("POST /career/run failed:", toSafeErrorMessage(error));
      res.status(500).json({ error: "Career orchestration failed unexpectedly" });
    }
  });

  return router;
}
