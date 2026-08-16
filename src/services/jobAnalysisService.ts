import type Anthropic from "@anthropic-ai/sdk";
import type { Job, JobValidationFailure } from "../schemas/job.js";
import type { EvidenceStatement } from "../schemas/jobMatch.js";
import { MATCH_SCORE_LABEL } from "../schemas/jobMatch.js";
import { loadJobsFromInput } from "./jobSourceService.js";
import { deduplicateJobs, filterEligibleJobs, type FilterOptions } from "./jobFilterService.js";
import { evaluateCareerSignal } from "./careerRelevanceFilter.js";
import { classifySearchTier, SEARCH_TIER_PRIORITY_ORDER, type SearchTier } from "./searchTierClassifier.js";
import { matchJobToProfile } from "../agents/jobMatchingAgent.js";
import {
  computeFreshnessScore,
  rankJobs,
  selectTopJobs,
  type RankableEntry,
  type RankedJob,
  type RankingOptions
} from "../ranking/jobRanking.js";
import type { RelevantProfileFields } from "./profileService.js";
import { ClaudeNotConfiguredError, toSafeErrorMessage } from "../utils/errors.js";

export interface TopJobResult {
  jobTitle: string;
  company: string;
  location: string;
  country: string;
  remoteStatus: string;
  sourceUrl: string;
  /** The job posting's own disclosed salary, or the literal string "UNKNOWN" — never an invented figure. */
  salary: number | "UNKNOWN";
  currency: string | "UNKNOWN";
  matchScoreLabel: string;
  matchScore: number;
  interviewPotential: number;
  careerGrowth: number;
  futureAIValue: number;
  recommendation: string;
  careerScore: number;
  classification: string;
  /**
   * Ratio-based only, and only computed when both a disclosed salary and a
   * caller-supplied referenceSalary exist (see src/ranking/jobRanking.ts).
   * This is NOT a LOW/MARKET/ABOVE_MARKET/HIGH_POTENTIAL classification —
   * that requires real market-rate benchmarks this codebase does not have.
   * A future Salary Intelligence phase is expected to supply that research;
   * until then this stays null whenever there's nothing legitimate to compare against.
   */
  salaryPotential: number | null;
  salaryDataAvailable: boolean;
  strongMatches: EvidenceStatement[];
  transferableSkills: EvidenceStatement[];
  gaps: EvidenceStatement[];
  risks: EvidenceStatement[];
  reason: string;
}

function toTopJobResult(ranked: RankedJob): TopJobResult {
  return {
    jobTitle: ranked.job.jobTitle,
    company: ranked.job.company,
    location: ranked.job.location,
    country: ranked.job.country,
    remoteStatus: ranked.job.remoteStatus,
    sourceUrl: ranked.job.sourceUrl,
    salary: ranked.job.salary ?? "UNKNOWN",
    currency: ranked.job.currency ?? "UNKNOWN",
    matchScoreLabel: MATCH_SCORE_LABEL,
    matchScore: ranked.match.matchScore,
    interviewPotential: ranked.match.interviewPotential,
    careerGrowth: ranked.match.careerGrowth,
    futureAIValue: ranked.match.futureAIValue,
    recommendation: ranked.match.recommendation,
    careerScore: ranked.careerScore,
    classification: ranked.classification,
    salaryPotential: ranked.scoreBreakdown.salaryPotential,
    salaryDataAvailable: ranked.scoreBreakdown.salaryDataAvailable,
    strongMatches: ranked.match.strongMatches,
    transferableSkills: ranked.match.transferableSkills,
    gaps: ranked.match.gaps,
    risks: ranked.match.risks,
    reason: ranked.match.reason
  };
}

export interface ClaudeFailure {
  jobTitle: string;
  company: string;
  error: string;
}

export interface AnalyzeJobsDependencies {
  /** Optional: only required when there is at least one eligible job to analyze. */
  claudeClient?: Anthropic;
  profile: RelevantProfileFields;
  filterOptions?: FilterOptions;
  rankingOptions?: RankingOptions;
  topCount?: number;
  /**
   * Caps how many of the deterministically-eligible jobs are actually sent
   * to Claude (token/cost control — see Phase 8 spec §10). Omit for no cap;
   * existing callers are unaffected. `jobsEligible` in the result always
   * reflects the true, uncapped filter count regardless of this setting.
   */
  maxJobs?: number;
  /**
   * When true, also returns the full ranked Job+JobMatch objects (not just
   * the flattened TopJobResult summary) — added so Phase 8's orchestrator
   * can feed real jobs into Resume Tailoring/Evidence Guard/Resume QA/
   * Application Package without re-deriving or duplicating this phase's
   * matching/ranking logic. Defaults to false; existing callers
   * (including POST /jobs/analyze) are unaffected and never see this field.
   */
  includeRankedJobs?: boolean;
  /**
   * Optional deterministic pre-Claude guard (Phase 8.3 Career Relevance
   * Gate) — when provided, a job for which this returns false is skipped
   * entirely: no Claude call is made for it, and it's tracked separately in
   * `relevanceFilteredCount`, not counted as a `claudeFailures` entry (it
   * never failed anything — it was never sent). Undefined by default, so
   * every existing caller (POST /career/run, POST /jobs/analyze) is
   * completely unaffected — only POST /career/discover-match passes one.
   */
  preMatchFilter?: (job: Job) => boolean;
}

export interface AnalyzeJobsResult {
  jobsReceived: number;
  jobsEligible: number;
  jobsAnalyzed: number;
  topJobs: TopJobResult[];
  invalidJobs?: JobValidationFailure[];
  claudeFailures?: ClaudeFailure[];
  /** Only present when `includeRankedJobs` was set — same jobs, same order, as `topJobs`. */
  rankedJobs?: RankedJob[];
  /** Only present when `preMatchFilter` was supplied — how many eligible jobs it excluded before any Claude call. */
  relevanceFilteredCount?: number;
  /** Only present when `preMatchFilter` was supplied (Phase 8.3.3) — how many jobs actually reached Claude (post-maxJobs-cap, post-preMatchFilter). Makes the pipeline measurable end to end. */
  jobsSentToMatching?: number;
}

/** Cheap, deterministic proxy for "how confident is this a real QA-family role" — never Claude-driven. Mirrors the tier ordering careerRelevanceFilter.ts already uses (strong title match > an explicit combination of secondary signals > a merely-plausible broad title). */
const SIGNAL_STRENGTH_SCORE: Record<string, number> = {
  STRONG_TITLE: 100,
  SECONDARY_SIGNALS: 70,
  AMBIGUOUS_TITLE: 40,
  NONE: 0
};

function candidateOrderingScore(job: Job): number {
  const strength = SIGNAL_STRENGTH_SCORE[evaluateCareerSignal(job).strength] ?? 0;
  const freshness = computeFreshnessScore(job) ?? 0;
  // Freshness is a minor tiebreak only (0-10 points), never enough to
  // outrank a stronger role signal — matches jobRanking.ts's own philosophy
  // that freshness is a tiebreaker, not a primary signal.
  return strength + freshness * 0.1;
}

/**
 * Fair, deterministic cross-source ordering (Phase 8.5.2 §5-6) — sorts each
 * source's own candidates by candidateOrderingScore() (role-signal
 * strength, then freshness), then round-robin merges across sources, so a
 * single large source (e.g. Remote OK returning 101 raw jobs against
 * Himalayas's 20) can never consume the entire maxJobs budget purely
 * because it returned more raw jobs. Used, unchanged, WITHIN each search
 * tier bucket by orderCandidatesForMatching() below (Phase 8.5.6 §9).
 */
function roundRobinMergeBySource(jobs: Job[]): Job[] {
  const bySource = new Map<string, Job[]>();
  for (const job of jobs) {
    const group = bySource.get(job.source);
    if (group) {
      group.push(job);
    } else {
      bySource.set(job.source, [job]);
    }
  }
  for (const group of bySource.values()) {
    group.sort((a, b) => candidateOrderingScore(b) - candidateOrderingScore(a));
  }

  const sourceGroups = Array.from(bySource.values());
  const merged: Job[] = [];
  for (let index = 0; merged.length < jobs.length; index++) {
    for (const group of sourceGroups) {
      if (index < group.length) {
        merged.push(group[index]);
      }
    }
  }
  return merged;
}

/**
 * Fair, deterministic candidate ordering (Phase 8.5.2 §5-6, extended by
 * Phase 8.5.6's targeted search-tier allocation) — used only when
 * `preMatchFilter` is supplied (POST /career/discover-match's multi-source
 * path; see analyzeJobs() below). Two layers, neither Claude-driven:
 * 1. Group candidates by classifySearchTier() (Tier 1 -> Tier 2 -> Tier 4 ->
 *    Tier 3 -> UNTIERED — Phase 8.5.6 §3/§8/§9), so senior leadership/
 *    architecture and AI-quality-specialized roles are prioritized ahead of
 *    generic Senior QA execution roles BEFORE the maxJobs cap is applied.
 *    This never changes which jobs qualify (the Career Relevance Gate and
 *    match threshold are untouched) — only which qualified candidates get
 *    the limited Claude calls first. A strong Tier 3 job can still outrank
 *    a weak Tier 1 job later, in the separate, unmodified strategic ranking
 *    stage (Phase 8.5.6 §12) — searchTier is an allocation priority, not a
 *    final-ranking guarantee.
 * 2. Within each tier, apply the existing fair, cross-source round-robin
 *    (roundRobinMergeBySource()) unchanged — so one source's raw volume
 *    still can't dominate within a tier either.
 */
export function orderCandidatesForMatching(jobs: Job[]): Job[] {
  const byTier = new Map<SearchTier, Job[]>();
  for (const job of jobs) {
    const tier = classifySearchTier(job);
    const group = byTier.get(tier);
    if (group) {
      group.push(job);
    } else {
      byTier.set(tier, [job]);
    }
  }

  const ordered: Job[] = [];
  for (const tier of SEARCH_TIER_PRIORITY_ORDER) {
    const tierJobs = byTier.get(tier);
    if (tierJobs) {
      ordered.push(...roundRobinMergeBySource(tierJobs));
    }
  }
  return ordered;
}

/**
 * The full Phase 2 pipeline: Validate -> Deduplicate -> Deterministic Filter
 * -> Claude Matching -> Deterministic Ranking -> Top 5. Orchestration only —
 * each step's actual logic lives in its own service/agent/ranking module.
 */
export async function analyzeJobs(rawJobs: unknown[], deps: AnalyzeJobsDependencies): Promise<AnalyzeJobsResult> {
  const jobsReceived = rawJobs.length;

  if (jobsReceived === 0) {
    return { jobsReceived: 0, jobsEligible: 0, jobsAnalyzed: 0, topJobs: [] };
  }

  const { validJobs, invalidJobs } = loadJobsFromInput(rawJobs);
  const dedupedJobs = deduplicateJobs(validJobs);
  const { eligible } = filterEligibleJobs(dedupedJobs, deps.filterOptions);
  const jobsEligible = eligible.length;

  // jobsEligible above always reports the true, uncapped deterministic-
  // filter count, regardless of maxJobs.
  //
  // Phase 8.5.2 fix: preMatchFilter is applied to the FULL eligible list
  // BEFORE maxJobs caps anything — never the reverse. Capping first (the
  // pre-8.5.2 behavior) meant maxJobs limited which RAW candidates were
  // ever considered, not how many QUALIFYING candidates reached Claude: with
  // many sources/jobs, the first maxJobs raw candidates could all fail the
  // filter, sending 0 jobs to Claude even though plenty of qualifying jobs
  // existed further down the eligible list (see docs/JOB_SOURCES.md history
  // / the Phase 8.5.2 production report for the concrete case: 53 eligible
  // candidates, maxJobs=3, all 3 raw candidates taken first happened to
  // fail the filter, so 0 jobs ever reached Claude).
  let relevanceFilteredCount = 0;
  let jobsToMatch: Job[];

  if (deps.preMatchFilter) {
    const qualifying = eligible.filter((job) => {
      const passes = deps.preMatchFilter!(job);
      if (!passes) {
        relevanceFilteredCount += 1;
      }
      return passes;
    });
    // Fair, deterministic ordering across sources (Phase 8.5.2 §5-6) applied
    // to the QUALIFYING set, then capped to maxJobs — guarantees
    // jobsSentToMatching <= maxJobs while maximizing the chance the capped
    // budget is spent on strong, source-diverse candidates.
    const ordered = orderCandidatesForMatching(qualifying);
    jobsToMatch = deps.maxJobs !== undefined ? ordered.slice(0, deps.maxJobs) : ordered;
  } else {
    // Unchanged for every caller that doesn't supply preMatchFilter
    // (/career/run, /jobs/analyze) — maxJobs still caps the eligible list
    // directly, in its original order, exactly as before Phase 8.5.2.
    jobsToMatch = deps.maxJobs !== undefined ? eligible.slice(0, deps.maxJobs) : eligible;
  }

  if (jobsToMatch.length > 0 && !deps.claudeClient) {
    throw new ClaudeNotConfiguredError();
  }
  const claudeClient = deps.claudeClient as Anthropic;

  const matched: RankableEntry[] = [];
  const claudeFailures: ClaudeFailure[] = [];

  // Sequential, not parallel: keeps Claude call volume predictable and avoids
  // bursting past rate limits for what is, at MVP scale, a small batch of jobs.
  for (const job of jobsToMatch) {
    try {
      const match = await matchJobToProfile(job, deps.profile, { client: claudeClient });
      matched.push({ job, match });
    } catch (error) {
      claudeFailures.push({ jobTitle: job.jobTitle, company: job.company, error: toSafeErrorMessage(error) });
    }
  }

  const jobsAnalyzed = matched.length;
  const ranked = rankJobs(matched, deps.rankingOptions);
  const topRanked = selectTopJobs(ranked, deps.topCount ?? 5);
  const topJobs = topRanked.map(toTopJobResult);

  const result: AnalyzeJobsResult = { jobsReceived, jobsEligible, jobsAnalyzed, topJobs };
  if (invalidJobs.length > 0) {
    result.invalidJobs = invalidJobs;
  }
  if (deps.preMatchFilter) {
    result.relevanceFilteredCount = relevanceFilteredCount;
    result.jobsSentToMatching = jobsToMatch.length;
  }
  if (claudeFailures.length > 0) {
    result.claudeFailures = claudeFailures;
  }
  if (deps.includeRankedJobs) {
    result.rankedJobs = topRanked;
  }
  return result;
}
