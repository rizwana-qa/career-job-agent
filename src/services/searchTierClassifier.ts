import type { Job } from "../schemas/job.js";

/**
 * Deterministic search-tier classification (Phase 8.5.6 §10-11) — never
 * Claude-driven. Answers a DIFFERENT question than careerRelevanceScore
 * (how strongly does this role belong to the target career family) or
 * matchScore (how well does this specific job fit the candidate):
 * searchTier answers "what KIND of role is this, for search/allocation
 * purposes" — a title-only classification, kept deliberately separate from
 * strategicRanking.ts's evaluateSeniorityScope() (which additionally reads
 * responsibilities/description to refine a SCOPE score for final ranking).
 * A job's searchTier never changes its strategicRankingScore directly — see
 * jobAnalysisService.ts's orderCandidatesForMatching() for how tier is used
 * purely as a pre-Claude allocation priority, and careerDiscoverMatch.ts's
 * unchanged final ranking for how a strong Tier 3 job can still outrank a
 * weak Tier 1 job (Phase 8.5.6 §12).
 */
export type SearchTier = "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | "UNTIERED";

/** Priority order for candidate allocation (Phase 8.5.6 §3) — Tier 1 -> Tier 2 -> Tier 4 -> Tier 3 -> UNTIERED. */
export const SEARCH_TIER_PRIORITY_ORDER: readonly SearchTier[] = ["TIER_1", "TIER_2", "TIER_4", "TIER_3", "UNTIERED"];

/**
 * TIER 4 (AI/LLM/RAG/Agent specialization) is checked FIRST, ahead of Tier
 * 1's Principal/Staff/Architect patterns — per Phase 8.5.6 §2's own example
 * ("AI Quality Assurance Lead" is explicitly listed under Tier 4, even
 * though it also contains "Lead"). AI specialization is the candidate's
 * stated primary career direction (profile/career_profile.md), so it takes
 * precedence over a seniority word alone when both are present in a title.
 */
const TIER_4_TITLE_PATTERNS: RegExp[] = [/\bai\b/i, /\bllm\b/i, /\brag\b/i, /\bgenai\b/i, /\bagent\b/i];
const TIER_1_TITLE_PATTERNS: RegExp[] = [/\bprincipal\b/i, /\bstaff\b/i, /\barchitect\b/i];
const TIER_2_TITLE_PATTERNS: RegExp[] = [/\blead\b/i];
const TIER_3_TITLE_PATTERNS: RegExp[] = [/\bsenior\b/i, /\bsr\.?\b/i];

/**
 * Title-only classification (never description/responsibilities — those
 * refine strategicRanking.ts's separate scope score, not this tier). Safe
 * to be broad here because classifySearchTier() only ever runs on jobs that
 * have already passed the unchanged positive career-signal pre-Claude
 * filter (careerRelevanceFilter.ts) — i.e. jobs already confirmed to carry
 * some genuine QA/testing/automation/AI-quality signal.
 */
export function classifySearchTier(job: Job): SearchTier {
  const title = job.jobTitle;
  if (TIER_4_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return "TIER_4";
  }
  if (TIER_1_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return "TIER_1";
  }
  if (TIER_2_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return "TIER_2";
  }
  if (TIER_3_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return "TIER_3";
  }
  return "UNTIERED";
}
