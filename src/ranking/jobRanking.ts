import type { Job } from "../schemas/job.js";
import type { JobMatch } from "../schemas/jobMatch.js";

export type CareerPriority = "EXCEPTIONAL" | "HIGH_PRIORITY" | "CONSIDER" | "LOW_PRIORITY" | "REJECT";

/**
 * Weights when a salary figure is available and a reference to compare it
 * against is configured. When either is missing, salaryPotential is dropped
 * from the calculation entirely and the remaining weights are renormalized
 * to sum to 100 — never replaced with a guessed or neutral number. There is
 * no fixed market salary benchmark in this codebase (see profile/job_preferences.md);
 * a reference must be supplied by the caller, or salary is left out of the score.
 */
const WEIGHTS = {
  matchScore: 0.35,
  interviewPotential: 0.3,
  careerGrowth: 0.15,
  futureAIValue: 0.1,
  salaryPotential: 0.1,
  /**
   * Only ever active when RankingOptions.applyFreshnessBonus is explicitly
   * true (Phase 8.5 §10) — deliberately a minor weight, since freshness is a
   * tiebreaker, not a primary signal: "a strong Principal QA role should
   * beat a fresh weak job" (§10). Every existing caller (POST /career/run,
   * POST /jobs/analyze) never sets this option, so their weightsUsed/
   * careerScore output is byte-for-byte unchanged by this addition.
   */
  freshness: 0.05
} as const;

export interface RankingOptions {
  /** Caller-supplied benchmark used only to score disclosed salaries. Never defaulted or invented. */
  referenceSalary?: number;
  /** Phase 8.5 §10 — opt-in only; undefined/false preserves pre-8.5 ranking exactly. */
  applyFreshnessBonus?: boolean;
}

export interface ScoreBreakdown {
  matchScore: number;
  interviewPotential: number;
  careerGrowth: number;
  futureAIValue: number;
  salaryPotential: number | null;
  salaryDataAvailable: boolean;
  /** Field name matches the WEIGHTS key exactly ("freshness", not "freshnessScore") — weightedScore() below looks breakdown fields up by weight key name, the same convention salaryPotential already follows. */
  freshness: number | null;
  freshnessDataAvailable: boolean;
  weightsUsed: Partial<Record<keyof typeof WEIGHTS, number>>;
}

/**
 * Freshness priority buckets (Phase 8.5 §10) — a ranking tiebreaker, never a
 * rejection criterion ("do not reject older jobs solely because of age").
 * Returns null (never a guessed score) when datePosted can't be parsed.
 */
export function computeFreshnessScore(job: Job): number | null {
  const posted = new Date(job.datePosted).getTime();
  if (!Number.isFinite(posted)) {
    return null;
  }
  const ageHours = (Date.now() - posted) / (1000 * 60 * 60);
  if (ageHours < 0) {
    return null; // future-dated — nothing sensible to compute, not guessed.
  }
  if (ageHours <= 24) return 100;
  if (ageHours <= 72) return 85;
  if (ageHours <= 24 * 7) return 65;
  if (ageHours <= 24 * 14) return 40;
  return 25; // older than 14 days — low, but never zero, per §10's "exceptional exact fit" allowance.
}

export interface RankedJob {
  job: Job;
  match: JobMatch;
  careerScore: number;
  classification: CareerPriority;
  scoreBreakdown: ScoreBreakdown;
}

function computeSalaryPotential(job: Job, options: RankingOptions): number | null {
  if (job.salary === undefined || options.referenceSalary === undefined || options.referenceSalary <= 0) {
    return null;
  }
  const ratio = (job.salary / options.referenceSalary) * 100;
  return Math.max(0, Math.min(100, Math.round(ratio)));
}

export function calculateCareerScore(job: Job, match: JobMatch, options: RankingOptions = {}): ScoreBreakdown {
  const salaryPotential = computeSalaryPotential(job, options);
  const salaryDataAvailable = salaryPotential !== null;
  const freshness = options.applyFreshnessBonus ? computeFreshnessScore(job) : null;
  const freshnessDataAvailable = freshness !== null;

  const components: Record<string, number> = {
    matchScore: match.matchScore,
    interviewPotential: match.interviewPotential,
    careerGrowth: match.careerGrowth,
    futureAIValue: match.futureAIValue
  };
  const activeWeights: Record<string, number> = {
    matchScore: WEIGHTS.matchScore,
    interviewPotential: WEIGHTS.interviewPotential,
    careerGrowth: WEIGHTS.careerGrowth,
    futureAIValue: WEIGHTS.futureAIValue
  };

  if (salaryDataAvailable) {
    components.salaryPotential = salaryPotential as number;
    activeWeights.salaryPotential = WEIGHTS.salaryPotential;
  }
  if (freshnessDataAvailable) {
    components.freshness = freshness as number;
    activeWeights.freshness = WEIGHTS.freshness;
  }

  const weightSum = Object.values(activeWeights).reduce((sum, w) => sum + w, 0);

  return {
    matchScore: match.matchScore,
    interviewPotential: match.interviewPotential,
    careerGrowth: match.careerGrowth,
    futureAIValue: match.futureAIValue,
    salaryPotential,
    salaryDataAvailable,
    freshness,
    freshnessDataAvailable,
    weightsUsed: Object.fromEntries(
      Object.entries(activeWeights).map(([key, weight]) => [key, weight / weightSum])
    )
  };
}

function weightedScore(breakdown: ScoreBreakdown): number {
  let total = 0;
  for (const [key, weight] of Object.entries(breakdown.weightsUsed)) {
    const value = (breakdown as unknown as Record<string, number>)[key];
    total += value * (weight as number);
  }
  return Math.round(total);
}

export function classifyScore(score: number): CareerPriority {
  if (score >= 90) return "EXCEPTIONAL";
  if (score >= 80) return "HIGH_PRIORITY";
  if (score >= 70) return "CONSIDER";
  if (score >= 60) return "LOW_PRIORITY";
  return "REJECT";
}

export interface RankableEntry {
  job: Job;
  match: JobMatch;
}

/** Deterministic ranking — Claude never computes the final score or ordering. */
export function rankJobs(entries: RankableEntry[], options: RankingOptions = {}): RankedJob[] {
  const ranked = entries.map(({ job, match }) => {
    const scoreBreakdown = calculateCareerScore(job, match, options);
    const careerScore = weightedScore(scoreBreakdown);
    return {
      job,
      match,
      careerScore,
      classification: classifyScore(careerScore),
      scoreBreakdown
    };
  });

  return ranked.sort((a, b) => b.careerScore - a.careerScore);
}

export function selectTopJobs(rankedJobs: RankedJob[], count = 5): RankedJob[] {
  return rankedJobs.slice(0, count);
}
