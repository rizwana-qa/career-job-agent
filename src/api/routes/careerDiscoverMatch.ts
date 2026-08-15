import { Router } from "express";
import type Anthropic from "@anthropic-ai/sdk";
import { createClaudeClient } from "../../services/claudeClient.js";
import {
  loadCareerProfile,
  loadJobDiscoveryPreferences,
  type JobDiscoveryPreferences,
  type RelevantProfileFields
} from "../../services/profileService.js";
import { discoverJobs } from "../../services/jobDiscoveryService.js";
import { createRemotiveJobSource } from "../../jobSources/remotiveJobSource.js";
import type { JobSource } from "../../jobSources/jobSource.js";
import type { RankedJob, RankingOptions } from "../../ranking/jobRanking.js";
import { DiscoverMatchRequestSchema, type DiscoverMatchResult, type DiscoverMatchTopJob } from "../../schemas/careerDiscoverMatch.js";
import type { CareerRunStatus } from "../../schemas/careerRun.js";
import { InMemoryIdempotencyStore, type IdempotencyStore } from "../../services/careerOrchestrationService.js";
import { ClaudeNotConfiguredError, InvalidDiscoveryInputError, JobSourceError, toSafeErrorMessage } from "../../utils/errors.js";
import { formatZodIssues } from "../../utils/zod.js";
import { authenticateCareerAgentRequest } from "./careerAuth.js";

export interface CareerDiscoverMatchRouterDependencies {
  jobSource?: JobSource;
  claudeClient?: Anthropic;
  profile?: RelevantProfileFields;
  jobDiscoveryPreferences?: JobDiscoveryPreferences;
  rankingOptions?: RankingOptions;
  idempotencyStore?: IdempotencyStore<DiscoverMatchResult>;
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

let defaultIdempotencyStore: IdempotencyStore<DiscoverMatchResult> | undefined;
function getDefaultIdempotencyStore(): IdempotencyStore<DiscoverMatchResult> {
  if (!defaultIdempotencyStore) {
    defaultIdempotencyStore = new InMemoryIdempotencyStore<DiscoverMatchResult>();
  }
  return defaultIdempotencyStore;
}

/**
 * Same status logic as careerOrchestrationService.ts's determineStatus, but
 * scoped to just discovery+matching (this endpoint never touches the
 * downstream per-job pipeline, so there's no per-job-failure input here).
 */
function determineDiscoverMatchStatus(
  jobsDiscovered: number,
  jobsAfterFiltering: number,
  jobsMatched: number,
  matchingFailureCount: number
): CareerRunStatus {
  if (jobsDiscovered === 0) {
    return "COMPLETED"; // legitimately nothing to process — not a failure
  }
  if (jobsAfterFiltering > 0 && jobsMatched === 0 && matchingFailureCount > 0) {
    return "FAILED";
  }
  if (matchingFailureCount > 0) {
    return "PARTIAL";
  }
  return "COMPLETED";
}

function toDiscoverMatchTopJob(ranked: RankedJob): DiscoverMatchTopJob {
  return {
    jobId: ranked.job.externalJobId ?? ranked.job.sourceUrl,
    jobTitle: ranked.job.jobTitle,
    company: ranked.job.company,
    location: ranked.job.location,
    source: ranked.job.source,
    sourceUrl: ranked.job.sourceUrl,
    matchScore: ranked.match.matchScore,
    interviewPotential: ranked.match.interviewPotential,
    careerGrowth: ranked.match.careerGrowth,
    futureAIValue: ranked.match.futureAIValue,
    recommendation: ranked.match.recommendation,
    jobData: { job: ranked.job, match: ranked.match }
  };
}

/**
 * POST /career/discover-match — Phase 8.2, endpoint 1 of 2. Reuses
 * discoverJobs() (Job Discovery -> Filtering -> Claude Matching -> Ranking
 * -> Top N) completely unchanged; this route only shapes its output into a
 * safe, n8n-consumable response and adds CAREER_AGENT_API_KEY auth +
 * idempotency. Deliberately stops before any resume-tailoring work — see
 * docs/N8N_INTEGRATION.md for how this pairs with POST /career/process-job.
 */
export function createCareerDiscoverMatchRouter(deps: CareerDiscoverMatchRouterDependencies = {}): Router {
  const router = Router();

  router.post("/career/discover-match", async (req, res) => {
    if (!authenticateCareerAgentRequest(req, res, deps.apiKey)) {
      return;
    }

    const idempotencyStore = deps.idempotencyStore ?? getDefaultIdempotencyStore();
    const idempotencyKey = req.header("Idempotency-Key");
    if (idempotencyKey) {
      const cached = idempotencyStore.get(idempotencyKey);
      if (cached) {
        res.status(200).json(cached);
        return;
      }
    }

    const parsedRequest = DiscoverMatchRequestSchema.safeParse(req.body ?? {});
    if (!parsedRequest.success) {
      res.status(400).json({ error: "Invalid request body", details: formatZodIssues(parsedRequest.error) });
      return;
    }
    const { maxJobs, topJobs } = parsedRequest.data;

    let claudeClient: Anthropic | undefined = deps.claudeClient;
    if (!claudeClient) {
      try {
        claudeClient = createClaudeClient();
      } catch {
        claudeClient = undefined;
      }
    }

    let profile: RelevantProfileFields;
    let jobDiscoveryPreferences: JobDiscoveryPreferences;
    try {
      profile = deps.profile ?? loadCareerProfile();
      jobDiscoveryPreferences = deps.jobDiscoveryPreferences ?? loadJobDiscoveryPreferences();
    } catch (error) {
      console.error("POST /career/discover-match: failed to load profile/preferences:", toSafeErrorMessage(error));
      res.status(500).json({ error: "Career profile could not be loaded" });
      return;
    }

    try {
      const discovery = await discoverJobs(
        { criteria: {} },
        {
          jobSource: deps.jobSource ?? getDefaultJobSource(),
          claudeClient,
          profile,
          jobDiscoveryPreferences,
          rankingOptions: deps.rankingOptions,
          topCount: topJobs,
          maxJobs,
          includeRankedJobs: true
        }
      );

      const matchingFailures = discovery.claudeFailures?.length ?? 0;
      const jobsMatched = discovery.jobs.length;
      const status = determineDiscoverMatchStatus(discovery.jobsFound, discovery.jobsAfterFiltering, jobsMatched, matchingFailures);

      const result: DiscoverMatchResult = {
        status,
        jobsDiscovered: discovery.jobsFound,
        jobsAfterFiltering: discovery.jobsAfterFiltering,
        jobsMatched,
        matchingFailures,
        topJobs: (discovery.rankedJobs ?? []).map(toDiscoverMatchTopJob)
      };

      if (idempotencyKey) {
        idempotencyStore.set(idempotencyKey, result);
      }
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
        console.error("POST /career/discover-match: job source failure:", toSafeErrorMessage(error));
        res.status(502).json({ error: "Job source is currently unavailable" });
        return;
      }
      console.error("POST /career/discover-match failed:", toSafeErrorMessage(error));
      res.status(500).json({ error: "Job discovery and matching failed unexpectedly" });
    }
  });

  return router;
}
