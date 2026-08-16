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
 * TIER 4 (genuine AI-quality/testing specialization) is checked FIRST,
 * ahead of Tier 1's Principal/Staff/Architect patterns — per Phase 8.5.6
 * §2's own example ("AI Quality Assurance Lead" is explicitly listed under
 * Tier 4, even though it also contains "Lead"). Phase 8.5.9 §4 tightened
 * this from a bare `\bai\b`/`\bagent\b` match (which any "AI Engineer" or
 * "Data Scientist" would trip) to explicit compound testing/quality/eval
 * phrases — a generic "AI Engineer" or "Machine Learning Engineer" no
 * longer matches Tier 4 (or any tier) on title alone; it may still reach
 * Claude via the unchanged, separate positive career-signal prefilter
 * (careerRelevanceFilter.ts), just without a search-tier priority boost.
 */
const TIER_4_TITLE_PATTERNS: RegExp[] = [
  /\bai\s*quality\b/i,
  /\bai\s*qa\b/i,
  /\bai\s*testing\b/i,
  /\bai\s*test\b/i,
  /\bai\s*evals?\b/i,
  /\bai\s*evaluation\b/i,
  /\bllm\s*testing\b/i,
  /\bllm\s*test\b/i,
  /\bllm\s*evaluation\b/i,
  /\brag\s*testing\b/i,
  /\brag\s*test\b/i,
  /\brag\s*quality\b/i,
  /\bagent\s*testing\b/i,
  /\bagent\s*test\b/i,
  /\bagent\s*evaluation\b/i,
  /\bgenai\s*qa\b/i,
  /\bai\s*model\s*quality\b/i,
  // Phase 8.5.14 §6 — kept in sync with careerRelevanceFilter.ts's
  // STRONG_POSITIVE_TITLE_PATTERNS additions ("Agent Quality / Evals
  // Engineer" — a real Himalayas title — otherwise passes the career
  // prefilter but falls to UNTIERED here, an unjustified cross-system split).
  /\bagent\s*quality\b/i,
  /\bagent\s*evals?\b/i,
  /\bmodel\s*evaluation\b/i,
  /\bgenai\s*quality\b/i
];

/**
 * Phase 8.5.9 §2/§3/§5 — the genuine target-career-family title signal
 * required (in addition to a seniority/leadership word) before a title
 * qualifies for TIER_1/TIER_2/TIER_3. A bare "Principal"/"Staff"/
 * "Architect"/"Lead"/"Senior" is no longer sufficient by itself — this is
 * what stops "Principal Software Engineer" or "Staff Backend Engineer" from
 * being search-tier-classified as if they were quality-engineering roles.
 * AI-quality titles are intentionally excluded here — they're TIER_4's
 * concern (checked above, before this ever runs).
 */
const QUALITY_FAMILY_TITLE_PATTERNS: RegExp[] = [
  /\bqa\b/i,
  /\bquality\b/i,
  /\bsqa\b/i,
  /\bsdet\b/i,
  /\bsoftware\s*development\s*engineer\s*in\s*test\b/i,
  /\btest\s*engineer\b/i,
  /\btest\s*architect\b/i,
  /\bautomation\s*architect\b/i,
  /\btest\s*automation\b/i,
  // Phase 8.5.14 §3/§6 — QC/Quality Control only ever reaches this function
  // after already clearing careerRelevanceFilter.ts's contextual check (a
  // QC-titled job only passes hasPositiveCareerSignal() when its
  // description carries real software/testing evidence — see
  // AMBIGUOUS_TITLE_PATTERNS there), so by the time classifySearchTier()
  // sees it, its software-QA relevance is already confirmed and it's safe
  // to treat as a title-level quality-family signal here too.
  /\bqc\b/i,
  /\bquality\s*control\b/i
];

const TIER_1_SENIORITY_TITLE_PATTERNS: RegExp[] = [/\bprincipal\b/i, /\bstaff\b/i, /\barchitect\b/i];
const TIER_2_LEADERSHIP_TITLE_PATTERNS: RegExp[] = [/\blead\b/i];
const TIER_3_SENIOR_TITLE_PATTERNS: RegExp[] = [/\bsenior\b/i, /\bsr\.?\b/i];

/**
 * Title-only classification (never description/responsibilities — those
 * refine strategicRanking.ts's separate scope score, not this tier).
 * classifySearchTier() only ever runs on jobs that have already passed the
 * unchanged positive career-signal pre-Claude filter (careerRelevanceFilter.ts),
 * but that filter alone isn't a strong enough guarantee that a title
 * carrying a seniority word actually IS a quality-engineering role (see
 * Phase 8.5.8's diagnosis of a misclassified Tier 1 candidate) — so
 * TIER_1/TIER_2/TIER_3 each additionally require QUALITY_FAMILY_TITLE_PATTERNS
 * to match, not just the seniority/leadership word alone.
 */
export function classifySearchTier(job: Job): SearchTier {
  const title = job.jobTitle;

  if (TIER_4_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return "TIER_4";
  }

  const hasQualityFamilySignal = QUALITY_FAMILY_TITLE_PATTERNS.some((pattern) => pattern.test(title));
  if (!hasQualityFamilySignal) {
    return "UNTIERED";
  }

  if (TIER_1_SENIORITY_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return "TIER_1";
  }
  if (TIER_2_LEADERSHIP_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return "TIER_2";
  }
  if (TIER_3_SENIOR_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return "TIER_3";
  }
  return "UNTIERED";
}
