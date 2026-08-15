import type Anthropic from "@anthropic-ai/sdk";
import type { Job, JobValidationFailure } from "../schemas/job.js";
import { SearchCriteriaSchema, type SearchCriteria } from "../schemas/searchCriteria.js";
import type { JobSource, RawProviderJob } from "../jobSources/jobSource.js";
import { DEFAULT_ROLE_DISCOVERY_KEYWORDS } from "../jobSources/roleDiscovery.js";
import { loadJobsFromInput } from "./jobSourceService.js";
import { deduplicateDiscoveredJobs, deduplicateAcrossSources } from "./jobDeduplicationService.js";
import { DEFAULT_RELATED_KEYWORDS, mergeFilterOptions, type FilterOptions } from "./jobFilterService.js";
import { analyzeJobs, type ClaudeFailure, type TopJobResult } from "./jobAnalysisService.js";
import { loadCareerProfile, loadJobDiscoveryPreferences, type JobDiscoveryPreferences, type RelevantProfileFields } from "./profileService.js";
import type { RankedJob, RankingOptions } from "../ranking/jobRanking.js";
import { InvalidDiscoveryInputError, toSafeErrorMessage } from "../utils/errors.js";
import { formatZodIssues } from "../utils/zod.js";

export type SourceDiagnosticStatus = "OK" | "FAILED";

/** Per-source discovery outcome (Phase 8.4 §12) — only populated on the multi-source path (see `jobSources` below). */
export interface SourceDiagnostic {
  name: string;
  status: SourceDiagnosticStatus;
  jobsFound?: number;
}

/** Extends Phase 2's QA-generic keywords with AI-specific terms — "LLM Evaluation Engineer" or "AI Quality Architect" wouldn't otherwise match Phase 2's default related-keyword list. */
const DISCOVERY_RELATED_KEYWORDS = [...DEFAULT_RELATED_KEYWORDS, "ai", "llm", "rag", "evaluation", "artificial intelligence"];

export interface DiscoverJobsInput {
  /** Unvalidated caller input — re-validated via SearchCriteriaSchema, since it's the actual trust boundary. */
  criteria?: unknown;
}

export interface DiscoverJobsDependencies {
  /** Legacy single-source path (Phase 6) — required unless `jobSources` is supplied. Unchanged behavior: a source failure propagates uncaught. Used as-is by /career/run and /jobs/discover. */
  jobSource?: JobSource;
  /**
   * Multi-source path (Phase 8.4 §12) — when supplied (even with one
   * entry), discoverJobs() queries every source with per-source error
   * isolation (one source's failure never fails the whole discovery run)
   * and cross-source deduplication (deduplicateAcrossSources()) instead of
   * the legacy same-source-only deduplicateDiscoveredJobs(). Takes
   * precedence over `jobSource` when both are supplied. Only
   * POST /career/discover-match passes this — /career/run and
   * /jobs/discover are unaffected.
   */
  jobSources?: JobSource[];
  claudeClient?: Anthropic;
  profile?: RelevantProfileFields;
  jobDiscoveryPreferences?: JobDiscoveryPreferences;
  rankingOptions?: RankingOptions;
  topCount?: number;
  /** Caps how many eligible jobs are sent to Claude — see jobAnalysisService.ts. */
  maxJobs?: number;
  /** When true, also returns the full ranked Job+JobMatch objects — see jobAnalysisService.ts. Defaults to false. */
  includeRankedJobs?: boolean;
  /** Optional deterministic pre-Claude guard (Phase 8.3 Career Relevance Gate) — see jobAnalysisService.ts. Undefined by default; only POST /career/discover-match passes one. */
  preMatchFilter?: (job: Job) => boolean;
}

export interface DiscoverJobsResult {
  jobsFound: number;
  jobsValid: number;
  jobsAfterFiltering: number;
  jobs: TopJobResult[];
  invalidJobs?: JobValidationFailure[];
  claudeFailures?: ClaudeFailure[];
  /** Only present when `includeRankedJobs` was set. */
  rankedJobs?: RankedJob[];
  /** Only present when `preMatchFilter` was supplied — see jobAnalysisService.ts. */
  relevanceFilteredCount?: number;
  /** Only present when `preMatchFilter` was supplied (Phase 8.3.3) — see jobAnalysisService.ts. */
  jobsSentToMatching?: number;
  /** Only present when `jobSources` (plural) was supplied — see SourceDiagnostic above. */
  sourceDiagnostics?: SourceDiagnostic[];
}

function buildEffectiveCriteria(callerCriteria: SearchCriteria, preferences: JobDiscoveryPreferences): SearchCriteria {
  const defaults: SearchCriteria = {
    roleKeywords: [...DEFAULT_ROLE_DISCOVERY_KEYWORDS],
    ...(preferences.allowedCountries ? { countries: preferences.allowedCountries } : {}),
    ...(preferences.preferredIndustries ? { industries: preferences.preferredIndustries } : {}),
    ...(preferences.rolesToAvoid ? { excludedKeywords: preferences.rolesToAvoid } : {})
  };
  return SearchCriteriaSchema.parse({ ...defaults, ...callerCriteria });
}

function buildFilterOptions(preferences: JobDiscoveryPreferences, criteria: SearchCriteria): FilterOptions {
  return mergeFilterOptions({
    allowedCountries: preferences.allowedCountries,
    allowRemoteAnyCountry: preferences.allowRemoteAnyCountry,
    rolesToAvoid: preferences.rolesToAvoid,
    excludedIndustries: preferences.excludedIndustries,
    relatedKeywords: DISCOVERY_RELATED_KEYWORDS,
    minimumSalary: criteria.minimumSalary
  });
}

/** Deterministic recency filter — not something jobFilterService.ts (Phase 2) supports, and easy/honest to compute from datePosted. */
function filterByRecency(jobs: Job[], postedWithinDays: number | undefined): Job[] {
  if (postedWithinDays === undefined) {
    return jobs;
  }
  const cutoff = Date.now() - postedWithinDays * 24 * 60 * 60 * 1000;
  return jobs.filter((job) => {
    const posted = new Date(job.datePosted).getTime();
    return Number.isFinite(posted) && posted >= cutoff;
  });
}

/**
 * Phase 6 orchestration: Job Source -> Normalize -> Validate -> Deduplicate
 * -> (recency filter) -> existing Phase 2 pipeline (deterministic filter ->
 * Claude Job Matching -> Ranking -> Top N). The existing Phase 2 matching
 * and ranking logic is reused as-is via analyzeJobs() — never reimplemented
 * here, per the Phase 6 spec's explicit requirement that it remain the
 * authority for semantic matching and ranking.
 */
export async function discoverJobs(input: DiscoverJobsInput, deps: DiscoverJobsDependencies): Promise<DiscoverJobsResult> {
  const criteriaResult = SearchCriteriaSchema.safeParse(input.criteria ?? {});
  if (!criteriaResult.success) {
    throw new InvalidDiscoveryInputError("Invalid search criteria", formatZodIssues(criteriaResult.error));
  }

  const preferences = deps.jobDiscoveryPreferences ?? loadJobDiscoveryPreferences();
  const effectiveCriteria = buildEffectiveCriteria(criteriaResult.data, preferences);

  let jobsFound = 0;
  let normalizedCandidates: unknown[] = [];
  let sourceDiagnostics: SourceDiagnostic[] | undefined;

  if (deps.jobSources && deps.jobSources.length > 0) {
    // Multi-source path (Phase 8.4 §12) — one source's failure is isolated
    // and recorded, never propagated; discovery continues with the rest.
    sourceDiagnostics = [];
    for (const source of deps.jobSources) {
      try {
        const raw: RawProviderJob[] = await source.searchJobs(effectiveCriteria);
        jobsFound += raw.length;
        const normalized = raw
          .map((r) => source.normalize(r))
          .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null && candidate !== undefined);
        normalizedCandidates.push(...normalized);
        sourceDiagnostics.push({ name: source.name, status: "OK", jobsFound: raw.length });
      } catch (error) {
        sourceDiagnostics.push({ name: source.name, status: "FAILED" });
        console.error(`Job source "${source.name}" failed during discovery:`, toSafeErrorMessage(error));
      }
    }
  } else {
    // Legacy single-source path (Phase 6/8.2) — unchanged: a source failure
    // propagates uncaught, exactly as before Phase 8.4. Used by /career/run
    // and /jobs/discover.
    if (!deps.jobSource) {
      throw new InvalidDiscoveryInputError("No job source configured", []);
    }
    const rawJobs = await deps.jobSource.searchJobs(effectiveCriteria);
    jobsFound = rawJobs.length;
    normalizedCandidates = rawJobs
      .map((raw) => deps.jobSource!.normalize(raw))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null && candidate !== undefined);
  }

  const { validJobs, invalidJobs } = loadJobsFromInput(normalizedCandidates);
  const jobsValid = validJobs.length;

  const deduped = sourceDiagnostics ? deduplicateAcrossSources(validJobs).deduplicated : deduplicateDiscoveredJobs(validJobs);
  const recent = filterByRecency(deduped, effectiveCriteria.postedWithinDays);

  const filterOptions = buildFilterOptions(preferences, effectiveCriteria);
  const profile = deps.profile ?? loadCareerProfile();

  const analysis = await analyzeJobs(recent, {
    claudeClient: deps.claudeClient,
    profile,
    filterOptions,
    rankingOptions: deps.rankingOptions,
    topCount: deps.topCount,
    maxJobs: deps.maxJobs,
    includeRankedJobs: deps.includeRankedJobs,
    preMatchFilter: deps.preMatchFilter
  });

  const result: DiscoverJobsResult = {
    jobsFound,
    jobsValid,
    jobsAfterFiltering: analysis.jobsEligible,
    jobs: analysis.topJobs
  };
  if (invalidJobs.length > 0) {
    result.invalidJobs = invalidJobs;
  }
  if (analysis.claudeFailures && analysis.claudeFailures.length > 0) {
    result.claudeFailures = analysis.claudeFailures;
  }
  if (analysis.rankedJobs) {
    result.rankedJobs = analysis.rankedJobs;
  }
  if (analysis.relevanceFilteredCount !== undefined) {
    result.relevanceFilteredCount = analysis.relevanceFilteredCount;
  }
  if (analysis.jobsSentToMatching !== undefined) {
    result.jobsSentToMatching = analysis.jobsSentToMatching;
  }
  if (sourceDiagnostics) {
    result.sourceDiagnostics = sourceDiagnostics;
  }
  return result;
}
