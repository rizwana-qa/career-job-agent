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
  salaryPotential: 0.1
} as const;

export interface RankingOptions {
  /** Caller-supplied benchmark used only to score disclosed salaries. Never defaulted or invented. */
  referenceSalary?: number;
}

export interface ScoreBreakdown {
  matchScore: number;
  interviewPotential: number;
  careerGrowth: number;
  futureAIValue: number;
  salaryPotential: number | null;
  salaryDataAvailable: boolean;
  weightsUsed: Partial<Record<keyof typeof WEIGHTS, number>>;
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

  const weightSum = Object.values(activeWeights).reduce((sum, w) => sum + w, 0);

  return {
    matchScore: match.matchScore,
    interviewPotential: match.interviewPotential,
    careerGrowth: match.careerGrowth,
    futureAIValue: match.futureAIValue,
    salaryPotential,
    salaryDataAvailable,
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
