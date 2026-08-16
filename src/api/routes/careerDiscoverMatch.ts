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
import { getEnabledJobSources } from "../../jobSources/jobSourceRegistry.js";
import type { JobSource } from "../../jobSources/jobSource.js";
import type { Job } from "../../schemas/job.js";
import type { RankedJob, RankingOptions } from "../../ranking/jobRanking.js";
import {
  DiscoverMatchRequestSchema,
  type DiscoverMatchResult,
  type DiscoverMatchTopJob,
  type SourceDiagnostic
} from "../../schemas/careerDiscoverMatch.js";
import type { CareerRunStatus } from "../../schemas/careerRun.js";
import { InMemoryIdempotencyStore, type IdempotencyStore } from "../../services/careerOrchestrationService.js";
import {
  isHardNegativeRole,
  hasPositiveCareerSignal,
  isNonSoftwareQaRole,
  CAREER_RELEVANCE_SCORE_THRESHOLD,
  MATCH_SCORE_THRESHOLD,
  SHORTLIST_ELIGIBLE_RECOMMENDATIONS
} from "../../services/careerRelevanceFilter.js";
import { isLocationEligible } from "../../services/locationEligibilityFilter.js";
import { calculateStrategicRankingScore } from "../../ranking/strategicRanking.js";
import { classifySearchTier } from "../../services/searchTierClassifier.js";
import { buildTierPrioritizedRoleKeywords } from "../../jobSources/searchConcepts.js";
import { ClaudeNotConfiguredError, InvalidDiscoveryInputError, JobSourceError, toSafeErrorMessage } from "../../utils/errors.js";
import { formatZodIssues } from "../../utils/zod.js";
import { authenticateCareerAgentRequest } from "./careerAuth.js";

export interface CareerDiscoverMatchRouterDependencies {
  /** Legacy single-source override — still supported for backward compatibility with earlier tests/callers; wrapped into a one-entry `jobSources` array. */
  jobSource?: JobSource;
  /** Phase 8.4 multi-source override — when supplied, takes precedence over `jobSource` and the env-driven registry. */
  jobSources?: JobSource[];
  claudeClient?: Anthropic;
  profile?: RelevantProfileFields;
  jobDiscoveryPreferences?: JobDiscoveryPreferences;
  rankingOptions?: RankingOptions;
  idempotencyStore?: IdempotencyStore<DiscoverMatchResult>;
  /** Overrides env.careerAgentApiKey — mainly for tests. */
  apiKey?: string;
}

/** Resolves which sources this request should query (Phase 8.4 §3/§11): explicit override > legacy single-source override > env-configured registry. */
function resolveJobSources(deps: CareerDiscoverMatchRouterDependencies): JobSource[] {
  if (deps.jobSources && deps.jobSources.length > 0) {
    return deps.jobSources;
  }
  if (deps.jobSource) {
    return [deps.jobSource];
  }
  return getEnabledJobSources();
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
  matchingFailureCount: number,
  /** Phase 8.4 §12: every configured/attempted source failed outright — a hard failure even when jobsDiscovered legitimately ends up 0 as a result. Defaults to false so the pre-8.4 signature/behavior is preserved for any caller that doesn't pass it. */
  allSourcesFailed = false,
  /** Phase 8.4 §12: at least one (but not all) configured sources failed — "some sources fail but others succeed" degrades the run to PARTIAL even when matching itself had zero failures, since the discovered set is known-incomplete. Defaults to false. */
  anySourceFailed = false
): CareerRunStatus {
  if (allSourcesFailed) {
    return "FAILED";
  }
  if (jobsDiscovered === 0 && !anySourceFailed) {
    return "COMPLETED"; // legitimately nothing to process — not a failure
  }
  if (jobsAfterFiltering > 0 && jobsMatched === 0 && matchingFailureCount > 0) {
    return "FAILED";
  }
  if (matchingFailureCount > 0 || anySourceFailed) {
    return "PARTIAL";
  }
  return "COMPLETED";
}

/**
 * Career Relevance Gate (Phase 8.3) — the deterministic decision of whether
 * an already-Claude-matched job may enter the shortlist. The hard negative
 * filter (careerRelevanceFilter.ts's isHardNegativeRole) already kept
 * obvious mismatches from ever reaching Claude; this is the second,
 * narrower gate applied to jobs Claude *did* evaluate. All three conditions
 * are required — this is plain deterministic thresholding (CLAUDE.md rule
 * 7), not something delegated to Claude.
 */
function passesCareerRelevanceGate(ranked: RankedJob): boolean {
  const careerRelevanceScore = ranked.match.careerRelevanceScore;
  if (careerRelevanceScore === undefined || careerRelevanceScore < CAREER_RELEVANCE_SCORE_THRESHOLD) {
    return false;
  }
  if (ranked.match.matchScore < MATCH_SCORE_THRESHOLD) {
    return false;
  }
  if (!SHORTLIST_ELIGIBLE_RECOMMENDATIONS.has(ranked.match.recommendation)) {
    return false;
  }
  return true;
}

/**
 * Phase 8.3.2 diagnostic — explains WHY a Claude-matched job was excluded
 * from topJobs, without weakening the gate itself. Root cause of the
 * original "jobsMatched > 0 but topJobs = []" report: careerRelevanceScore
 * is `.optional()` on JobMatchSchema (deliberately, for backward
 * compatibility — see jobMatch.ts), so a Claude response that omits it
 * still passes schema validation and silently fails the gate exactly like a
 * genuinely low score would, with no prior signal distinguishing the two.
 * This never changes pass/fail — only what gets logged (title/company/
 * scores/recommendation only, never job description or profile content) so
 * a future empty-topJobs run can be diagnosed from server logs alone.
 */
function describeGateRejectionReasons(ranked: RankedJob): string[] {
  const reasons: string[] = [];
  const careerRelevanceScore = ranked.match.careerRelevanceScore;
  if (careerRelevanceScore === undefined) {
    reasons.push("careerRelevanceScore missing from Claude's response (schema allows this optionally)");
  } else if (careerRelevanceScore < CAREER_RELEVANCE_SCORE_THRESHOLD) {
    reasons.push(`careerRelevanceScore ${careerRelevanceScore} < ${CAREER_RELEVANCE_SCORE_THRESHOLD}`);
  }
  if (ranked.match.matchScore < MATCH_SCORE_THRESHOLD) {
    reasons.push(`matchScore ${ranked.match.matchScore} < ${MATCH_SCORE_THRESHOLD}`);
  }
  if (!SHORTLIST_ELIGIBLE_RECOMMENDATIONS.has(ranked.match.recommendation)) {
    reasons.push(`recommendation "${ranked.match.recommendation}" not in {APPLY, CONSIDER}`);
  }
  return reasons;
}

/**
 * Pre-Claude deterministic pipeline (Phase 8.3.3, extended by Phase 8.5 §6-8):
 * Location eligibility -> Hard negative title filter -> Non-software-QA
 * filter -> Positive career relevance prefilter, checked in that order so
 * the logged rejection reason always reflects the FIRST stage that actually
 * rejected a job. isHardNegativeRole()/hasPositiveCareerSignal() themselves
 * are unmodified (Phase 8.5 §7) — isNonSoftwareQaRole() is a new, separate
 * check composed in here alongside them, not a change to either.
 */
function buildPreClaudeFilter(): (job: Job) => boolean {
  return (job: Job): boolean => {
    if (!isLocationEligible(job)) {
      logPreClaudeRejection(job, "location not eligible (not Pakistan/UAE, and not remote-eligible)");
      return false;
    }
    if (isHardNegativeRole(job)) {
      logPreClaudeRejection(job, "hard negative title match (help desk/service desk/IT support/sysadmin/etc.)");
      return false;
    }
    if (isNonSoftwareQaRole(job)) {
      logPreClaudeRejection(job, "non-software-QA role (food/manufacturing/construction/pharma QC, BPO quality analyst, AI data labeling, etc.)");
      return false;
    }
    if (!hasPositiveCareerSignal(job)) {
      logPreClaudeRejection(job, "insufficient positive QA/testing/automation/AI-quality signal");
      return false;
    }
    return true;
  };
}

function logPreClaudeRejection(job: Job, reason: string): void {
  console.log(
    JSON.stringify({
      source: "career-agent",
      stage: "pre_claude_filter",
      event: "rejected",
      jobTitle: job.jobTitle,
      company: job.company,
      reason
    })
  );
}

function toDiscoverMatchTopJob(ranked: RankedJob, rankingReason: string, searchTier: string): DiscoverMatchTopJob {
  return {
    jobId: ranked.job.externalJobId ?? ranked.job.sourceUrl,
    jobTitle: ranked.job.jobTitle,
    company: ranked.job.company,
    location: ranked.job.location,
    country: ranked.job.country,
    remoteStatus: ranked.job.remoteStatus,
    employmentType: ranked.job.employmentType,
    ...(ranked.job.salary !== undefined ? { salary: ranked.job.salary } : {}),
    ...(ranked.job.currency !== undefined ? { currency: ranked.job.currency } : {}),
    datePosted: ranked.job.datePosted,
    source: ranked.job.source,
    sourceUrl: ranked.job.sourceUrl,
    // Safe fallback for the type system only — every job reaching this
    // mapper has already passed passesCareerRelevanceGate(), which requires
    // careerRelevanceScore to be a defined number >= threshold.
    careerRelevanceScore: ranked.match.careerRelevanceScore ?? 0,
    matchScore: ranked.match.matchScore,
    interviewPotential: ranked.match.interviewPotential,
    careerGrowth: ranked.match.careerGrowth,
    futureAIValue: ranked.match.futureAIValue,
    recommendation: ranked.match.recommendation,
    whySelected: ranked.match.whySelected ?? ranked.match.reason,
    rankingReason,
    searchTier,
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
      const jobSources = resolveJobSources(deps);
      const discovery = await discoverJobs(
        // Phase 8.5.6 §4/§14: explicit, tier-prioritized (Tier 1 -> Tier 2 ->
        // Tier 4 -> Tier 3) role-keyword list, scoped to this endpoint's own
        // discoverJobs() call only — /career/run and /jobs/discover keep
        // their own separate call sites (untouched) with the generic
        // DEFAULT_ROLE_DISCOVERY_KEYWORDS. A source that reads
        // roleKeywords[0] as its primary query term (Himalayas) therefore
        // naturally searches for a Tier 1 concept first, with no change to
        // the adapter itself; Remote OK has no query mechanism at all (its
        // adapter fetches one unfiltered feed — see remoteOkJobSource.ts),
        // so for that source tier prioritization is realized entirely
        // downstream, via orderCandidatesForMatching()'s tier allocation.
        { criteria: { roleKeywords: buildTierPrioritizedRoleKeywords() } },
        {
          // Phase 8.4: always the plural multi-source path (even a single
          // configured source goes through it), so per-source error
          // isolation and cross-source dedup are always in effect for this
          // endpoint. /career/run and /jobs/discover are untouched — they
          // still pass the singular `jobSource` and never see this path.
          jobSources,
          claudeClient,
          profile,
          jobDiscoveryPreferences,
          // Phase 8.5 §10 — freshness as a minor ranking tiebreaker for this
          // endpoint only; /career/run and /jobs/discover never set this and
          // are unaffected. A caller-supplied rankingOptions can still
          // override it explicitly.
          rankingOptions: { applyFreshnessBonus: true, ...deps.rankingOptions },
          // Deliberately NOT topJobs here — that's the caller's requested
          // *shortlist* size, applied below after the Career Relevance
          // Gate. Requesting topCount: maxJobs instead gets back every job
          // Claude successfully matched (bounded only by how many were
          // ever sent to Claude), so the gate has the full ranked list to
          // filter before truncating to what the caller actually asked for.
          topCount: maxJobs,
          maxJobs,
          includeRankedJobs: true,
          // Pre-Claude deterministic pipeline (Phase 8.3 + 8.4 + 8.3.3) — see
          // buildPreClaudeFilter() above for the three ordered checks.
          preMatchFilter: buildPreClaudeFilter()
        }
      );

      const matchingFailures = discovery.claudeFailures?.length ?? 0;
      // jobsMatched intentionally keeps its pre-Phase-8.3 meaning: jobs
      // Claude successfully evaluated, any recommendation, before the
      // relevance gate. This preserves determineDiscoverMatchStatus()'s
      // existing FAILED/PARTIAL semantics unchanged. topJobs.length below
      // is the actual shortlist count, after gating.
      const jobsMatched = discovery.jobs.length;
      const sources: SourceDiagnostic[] = discovery.sourceDiagnostics ?? [];
      // Phase 8.4 §12: every attempted source failing outright is a hard
      // failure, even if that legitimately leaves jobsDiscovered at 0 (which
      // determineDiscoverMatchStatus's plain jobsDiscovered===0 branch would
      // otherwise read as "nothing to process" rather than "everything failed").
      const allSourcesFailed = sources.length > 0 && sources.every((s) => s.status === "FAILED");
      const anySourceFailed = sources.some((s) => s.status === "FAILED");
      const status = determineDiscoverMatchStatus(
        discovery.jobsFound,
        discovery.jobsAfterFiltering,
        jobsMatched,
        matchingFailures,
        allSourcesFailed,
        anySourceFailed
      );

      // Career Relevance Gate, part 2: careerRelevanceScore >= 70 AND
      // matchScore >= 70 AND recommendation in {APPLY, CONSIDER}. A REJECT
      // recommendation can never reach topJobs, regardless of scores. This
      // gate itself is unchanged (Phase 8.5.5 §8/§17) — nothing here alters
      // which jobs qualify, only the ORDER among jobs that already do.
      const rankedForGate = discovery.rankedJobs ?? [];
      const gatedJobs = rankedForGate.filter(passesCareerRelevanceGate);

      // Strategic shortlist ranking (Phase 8.5.5) — re-ranks the already-
      // gated, already-qualified set by career relevance, match score,
      // seniority/scope, interview potential, career growth, AI value,
      // location eligibility, and freshness, so e.g. a Principal/Staff/Lead/
      // Architect or high-scope Senior role outranks a technically-
      // qualified but manual-execution-heavy Senior role with a comparable
      // matchScore. See src/ranking/strategicRanking.ts.
      const strategicallyRanked = gatedJobs
        .map((ranked) => ({ ranked, strategic: calculateStrategicRankingScore(ranked) }))
        .sort((a, b) => b.strategic.score - a.strategic.score);
      const shortlisted = strategicallyRanked.slice(0, topJobs);

      // Safe diagnostic only (Phase 8.3.2) — title/company/scores/
      // recommendation, never job description or profile content. Lets a
      // future "jobsMatched > 0 but topJobs = []" report be root-caused from
      // server logs instead of re-derived blind.
      for (const rejected of rankedForGate) {
        if (!gatedJobs.includes(rejected)) {
          console.log(
            JSON.stringify({
              source: "career-agent",
              stage: "career_relevance_gate",
              event: "rejected",
              jobTitle: rejected.job.jobTitle,
              company: rejected.job.company,
              matchScore: rejected.match.matchScore,
              careerRelevanceScore: rejected.match.careerRelevanceScore ?? null,
              recommendation: rejected.match.recommendation,
              reasons: describeGateRejectionReasons(rejected)
            })
          );
        }
      }

      // Phase 8.3.3 — same underlying count, two field names (relevanceFiltered
      // kept for backward compatibility; preMatchFiltered is the accurately-
      // named field going forward, now that this covers three deterministic
      // checks, not just the hard negative title filter).
      const preMatchFiltered = discovery.relevanceFilteredCount ?? 0;
      const jobsSentToMatching = discovery.jobsSentToMatching ?? 0;

      const result: DiscoverMatchResult = {
        status,
        jobsDiscovered: discovery.jobsFound,
        jobsAfterFiltering: discovery.jobsAfterFiltering,
        jobsMatched,
        matchingFailures,
        relevanceFiltered: preMatchFiltered,
        preMatchFiltered,
        jobsSentToMatching,
        sources,
        topJobs: shortlisted.map(({ ranked, strategic }) => toDiscoverMatchTopJob(ranked, strategic.reason, classifySearchTier(ranked.job)))
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
