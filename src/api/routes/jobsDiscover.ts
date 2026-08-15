import { Router } from "express";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { createClaudeClient } from "../../services/claudeClient.js";
import {
  loadCareerProfile,
  type JobDiscoveryPreferences,
  type RelevantProfileFields
} from "../../services/profileService.js";
import { discoverJobs } from "../../services/jobDiscoveryService.js";
import { createRemotiveJobSource } from "../../jobSources/remotiveJobSource.js";
import type { JobSource } from "../../jobSources/jobSource.js";
import type { RankingOptions } from "../../ranking/jobRanking.js";
import { ClaudeNotConfiguredError, InvalidDiscoveryInputError, JobSourceError, toSafeErrorMessage } from "../../utils/errors.js";
import { formatZodIssues } from "../../utils/zod.js";

const DiscoverJobsRequestSchema = z.object({
  criteria: z.unknown().optional()
});

export interface JobsDiscoverRouterDependencies {
  jobSource?: JobSource;
  claudeClient?: Anthropic;
  profile?: RelevantProfileFields;
  jobDiscoveryPreferences?: JobDiscoveryPreferences;
  rankingOptions?: RankingOptions;
}

let defaultJobSource: JobSource | undefined;
function getDefaultJobSource(): JobSource {
  if (!defaultJobSource) {
    defaultJobSource = createRemotiveJobSource();
  }
  return defaultJobSource;
}

/**
 * POST /jobs/discover — NOT AUTHENTICATED, same posture as POST /jobs/analyze
 * (see docs/SECURITY.md). Localhost development only — DO NOT expose this
 * publicly until an auth layer exists.
 */
export function createJobsDiscoverRouter(deps: JobsDiscoverRouterDependencies = {}): Router {
  const router = Router();

  router.post("/jobs/discover", async (req, res) => {
    const parsedRequest = DiscoverJobsRequestSchema.safeParse(req.body ?? {});
    if (!parsedRequest.success) {
      res.status(400).json({
        error: "Invalid request body",
        details: formatZodIssues(parsedRequest.error)
      });
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

    let profile: RelevantProfileFields;
    try {
      profile = deps.profile ?? loadCareerProfile();
    } catch (error) {
      console.error("POST /jobs/discover: failed to load career profile:", toSafeErrorMessage(error));
      res.status(500).json({ error: "Career profile could not be loaded" });
      return;
    }

    try {
      const result = await discoverJobs(
        { criteria: parsedRequest.data.criteria },
        {
          jobSource: deps.jobSource ?? getDefaultJobSource(),
          claudeClient,
          profile,
          jobDiscoveryPreferences: deps.jobDiscoveryPreferences,
          rankingOptions: deps.rankingOptions
        }
      );
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof InvalidDiscoveryInputError) {
        res.status(400).json({ error: "Invalid search criteria", details: error.issues });
        return;
      }
      if (error instanceof ClaudeNotConfiguredError) {
        res.status(503).json({ error: "Claude API is not configured" });
        return;
      }
      if (error instanceof JobSourceError) {
        console.error("POST /jobs/discover: job source failure:", toSafeErrorMessage(error));
        res.status(502).json({ error: "Job source is currently unavailable" });
        return;
      }
      console.error("POST /jobs/discover failed:", toSafeErrorMessage(error));
      res.status(500).json({ error: "Job discovery failed unexpectedly" });
    }
  });

  return router;
}
