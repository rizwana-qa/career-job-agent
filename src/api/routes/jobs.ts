import { Router } from "express";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { createClaudeClient } from "../../services/claudeClient.js";
import {
  loadCareerProfile,
  loadJobPreferences,
  type JobPreferenceFilterDefaults,
  type RelevantProfileFields
} from "../../services/profileService.js";
import { analyzeJobs } from "../../services/jobAnalysisService.js";
import { mergeFilterOptions, type FilterOptions } from "../../services/jobFilterService.js";
import type { RankingOptions } from "../../ranking/jobRanking.js";
import { ClaudeNotConfiguredError, toSafeErrorMessage } from "../../utils/errors.js";
import { formatZodIssues } from "../../utils/zod.js";

const AnalyzeJobsRequestSchema = z.object({
  jobs: z.array(z.unknown())
});

export interface JobsRouterDependencies {
  claudeClient?: Anthropic;
  profile?: RelevantProfileFields;
  /** Overrides profile/job_preferences.md defaults — mainly for tests, so they don't depend on the real file. */
  jobPreferences?: JobPreferenceFilterDefaults;
  /** Caller-supplied filter options. Any key present here wins over the job_preferences.md default for that key. */
  filterOptions?: FilterOptions;
  rankingOptions?: RankingOptions;
}

/**
 * POST /jobs/analyze — NOT AUTHENTICATED. This endpoint is suitable for
 * localhost development only (see docs/SECURITY.md). DO NOT expose it
 * publicly or on any network beyond localhost until an auth layer is added.
 */
export function createJobsRouter(deps: JobsRouterDependencies = {}): Router {
  const router = Router();

  router.post("/jobs/analyze", async (req, res) => {
    const parsedRequest = AnalyzeJobsRequestSchema.safeParse(req.body);
    if (!parsedRequest.success) {
      res.status(400).json({
        error: "Invalid request body",
        details: formatZodIssues(parsedRequest.error)
      });
      return;
    }

    // Not eagerly required: an empty or fully-filtered job list never calls
    // Claude, so a missing key shouldn't block that case. analyzeJobs()
    // raises ClaudeNotConfiguredError only if a Claude call actually becomes
    // necessary once eligible jobs are known.
    let claudeClient: Anthropic | undefined = deps.claudeClient;
    if (!claudeClient) {
      try {
        claudeClient = createClaudeClient();
      } catch {
        claudeClient = undefined;
      }
    }

    let profile: RelevantProfileFields;
    let filterOptions: FilterOptions;
    try {
      profile = deps.profile ?? loadCareerProfile();
      const jobPreferenceDefaults = deps.jobPreferences ?? loadJobPreferences();
      filterOptions = mergeFilterOptions(jobPreferenceDefaults, deps.filterOptions);
    } catch (error) {
      console.error("POST /jobs/analyze: failed to load profile/preferences:", toSafeErrorMessage(error));
      res.status(500).json({ error: "Career profile or job preferences could not be loaded" });
      return;
    }

    try {
      const result = await analyzeJobs(parsedRequest.data.jobs, {
        claudeClient,
        profile,
        filterOptions,
        rankingOptions: deps.rankingOptions
      });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ClaudeNotConfiguredError) {
        res.status(503).json({ error: "Claude API is not configured" });
        return;
      }
      console.error("POST /jobs/analyze failed:", toSafeErrorMessage(error));
      res.status(500).json({ error: "Job analysis failed unexpectedly" });
    }
  });

  return router;
}
