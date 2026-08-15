import type { Job } from "../schemas/job.js";

/**
 * Career Relevance Gate — hard negative filter (Phase 8.3).
 *
 * Deterministic, pre-Claude guard for POST /career/discover-match only (not
 * shared with /career/run or /jobs/analyze — see careerDiscoverMatch.ts for
 * how it's wired in as an opt-in preMatchFilter). Matches against the job
 * TITLE only, never the description — a role whose title is "QA Engineer"
 * that happens to mention "IT service desk" once in its description must
 * not be rejected, while a role whose title itself IS "Tier III Service
 * Desk Engineer" must be. This is why every pattern below is applied to
 * `job.jobTitle` and not `job.jobDescription` or `job.responsibilities`.
 *
 * This is intentionally a coarse, high-confidence guard only — it exists to
 * skip the obvious cases before spending a Claude call, per CLAUDE.md rule
 * 7 ("use deterministic code for deterministic calculations"). The nuanced
 * judgment ("is this really outside the target career family?") is left to
 * Claude's careerRelevanceScore, per CLAUDE.md rule 8 ("use Claude only for
 * reasoning and semantic analysis") — this filter must never be extended
 * into a full keyword-scoring system; that job belongs to Claude.
 */
const HARD_NEGATIVE_TITLE_PATTERNS: RegExp[] = [
  /\bhelp[\s-]*desk\b/i,
  /\bservice[\s-]*desk\b/i,
  /\bdesktop\s*support\b/i,
  /\bit\s*support\b/i,
  /\btechnical\s*support\b/i,
  /\bend[\s-]*user\s*support\b/i,
  /\bfield\s*technician\b/i,
  /\bsystem\s*administrator\b/i,
  /\bnetwork\s*administrator\b/i,
  /\bnoc\b/i,
  /\bit\s*operations\b/i,
  /\bit\s*infrastructure\s*support\b/i
];

/**
 * Returns true when the job's TITLE is dominated by one of the hard
 * negative role categories (help desk, service desk, desktop/IT/technical
 * support, end-user support, field technician, system/network admin, NOC,
 * IT operations/infrastructure support) — a role that should never reach
 * Claude matching or the shortlist, regardless of anything else in the
 * description.
 */
export function isHardNegativeRole(job: Job): boolean {
  return HARD_NEGATIVE_TITLE_PATTERNS.some((pattern) => pattern.test(job.jobTitle));
}

/** Minimum careerRelevanceScore for a job to be eligible for the shortlist. */
export const CAREER_RELEVANCE_SCORE_THRESHOLD = 70;

/** Minimum matchScore for a job to be eligible for the shortlist. */
export const MATCH_SCORE_THRESHOLD = 70;

/** recommendation values that may reach the shortlist — REJECT never does. */
export const SHORTLIST_ELIGIBLE_RECOMMENDATIONS = new Set(["APPLY", "CONSIDER"]);
