import type Anthropic from "@anthropic-ai/sdk";
import type { JobValidationFailure } from "../schemas/job.js";
import type { EvidenceStatement } from "../schemas/jobMatch.js";
import { MATCH_SCORE_LABEL } from "../schemas/jobMatch.js";
import { loadJobsFromInput } from "./jobSourceService.js";
import { deduplicateJobs, filterEligibleJobs, type FilterOptions } from "./jobFilterService.js";
import { matchJobToProfile } from "../agents/jobMatchingAgent.js";
import { rankJobs, selectTopJobs, type RankableEntry, type RankedJob, type RankingOptions } from "../ranking/jobRanking.js";
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

  // maxJobs caps only what proceeds to Claude — jobsEligible above always
  // reports the true, uncapped deterministic-filter count.
  const jobsToMatch = deps.maxJobs !== undefined ? eligible.slice(0, deps.maxJobs) : eligible;

  // TEMPORARY diagnostic — safe counts/booleans only, no job/profile content.
  // Remove once the production "jobsMatched: 0, no outgoing requests" issue
  // (Vercel deployment, 2026-08-15) is root-caused.
  console.log(
    JSON.stringify({
      source: "career-agent-debug",
      stage: "analyzeJobs",
      jobsEligible: eligible.length,
      maxJobsParam: deps.maxJobs,
      jobsToMatchLength: jobsToMatch.length,
      hasClaudeClient: Boolean(deps.claudeClient)
    })
  );

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
  if (claudeFailures.length > 0) {
    result.claudeFailures = claudeFailures;
  }
  if (deps.includeRankedJobs) {
    result.rankedJobs = topRanked;
  }
  return result;
}
