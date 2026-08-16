import type { Job } from "../schemas/job.js";
import type { RankedJob } from "./jobRanking.js";
import { computeFreshnessScore } from "./jobRanking.js";
import { classifyRemoteEligibility } from "../services/locationEligibilityFilter.js";

/**
 * Strategic shortlist ranking (Phase 8.5.5) — used ONLY by
 * POST /career/discover-match, AFTER the existing, unmodified Career
 * Relevance Gate (careerRelevanceScore >= 70 AND matchScore >= 70 AND
 * recommendation APPLY/CONSIDER — see careerDiscoverMatch.ts). This module
 * never touches jobRanking.ts's shared rankJobs()/calculateCareerScore()
 * (still used as-is by /career/run and /jobs/analyze via
 * jobAnalysisService.ts) — it re-ranks only the already-gated, already-
 * qualified set for the final shortlist, and generates the human-readable
 * `rankingReason` string.
 *
 * Root problem this addresses: matchScore alone (or the pre-8.5.5 ranking,
 * which never considered seniority/scope, careerRelevanceScore, or location
 * eligibility as ranking factors) let a technically-qualified but heavily
 * manual-execution Senior role outrank stronger Principal/Staff/Lead/
 * Architect or high-scope Senior opportunities whenever it happened to have
 * a comparable matchScore. Nothing here changes WHICH jobs qualify — only
 * the ORDER among jobs that already qualify.
 */

export type TitleTier = "PRINCIPAL_ARCHITECT" | "STAFF" | "LEAD" | "SENIOR" | "MID" | "JUNIOR" | "UNSPECIFIED";
export type ScopeLabel = "HIGH_SCOPE" | "EXECUTION_FOCUSED" | "NEUTRAL";

export interface SeniorityScopeResult {
  titleTier: TitleTier;
  scopeLabel: ScopeLabel;
  /** 0-100. Title tier is the dominant factor; strong/weak scope signals in the description/responsibilities/requirements refine it — title is never used alone (Phase 8.5.5 §3). */
  score: number;
  strongSignalCount: number;
  weakSignalCount: number;
}

const TITLE_TIER_PATTERNS: Array<{ tier: TitleTier; patterns: RegExp[] }> = [
  { tier: "PRINCIPAL_ARCHITECT", patterns: [/\bprincipal\b/i, /\barchitect\b/i] },
  { tier: "STAFF", patterns: [/\bstaff\b/i] },
  { tier: "LEAD", patterns: [/\blead\b/i] },
  { tier: "SENIOR", patterns: [/\bsenior\b/i, /\bsr\.?\b/i] },
  { tier: "JUNIOR", patterns: [/\bjunior\b/i, /\bentry[\s-]*level\b/i, /\bassociate\b/i, /\bintern(ship)?\b/i] },
  { tier: "MID", patterns: [/\bmid[\s-]*level\b/i, /\b(engineer)\s*ii\b/i] }
];

/** Base score per title tier — refined, never solely determined, by scope-signal counts below. */
const TIER_BASE_SCORE: Record<TitleTier, number> = {
  PRINCIPAL_ARCHITECT: 95,
  STAFF: 85,
  LEAD: 75,
  SENIOR: 60,
  MID: 35,
  JUNIOR: 15,
  UNSPECIFIED: 50
};

/** Phase 8.5.5 §3 — strong scope signals, matched against description + responsibilities + requirements (never title alone). */
const STRONG_SCOPE_SIGNALS: RegExp[] = [
  /quality strategy/i,
  /test architecture/i,
  /automation architecture/i,
  /framework ownership/i,
  /quality engineering strategy/i,
  /technical leadership/i,
  /mentor(ing|s)?\b/i,
  /quality gates?/i,
  /ci\s*\/?\s*cd ownership/i,
  /risk[\s-]*based testing/i,
  /test infrastructure/i,
  /cross[\s-]*team quality ownership/i,
  /designing automation frameworks?/i,
  /leading qa initiatives/i
];

/** Phase 8.5.5 §3 — weak scope signals. Their presence is never disqualifying (manual testing is valid experience) — only a bounded ranking refinement. */
const WEAK_SCOPE_SIGNALS: RegExp[] = [
  /execute defined tasks/i,
  /manual testing/i,
  /manual execution/i,
  /under guidance/i,
  /following predefined test cases/i,
  /basic bug reporting/i,
  /support testing/i,
  /simple quality process issues/i,
  /limited decision ownership/i,
  /little autonomy/i
];

/** Signal-count adjustment is capped so it can refine a tier but never override it entirely (title tier stays dominant, per §3's "do not use title alone" — meaning "not title ALONE", not "ignore title"). */
const MAX_SIGNAL_ADJUSTMENT_STEPS = 4;
const SIGNAL_ADJUSTMENT_PER_STEP = 6;

function detectTitleTier(jobTitle: string): TitleTier {
  for (const { tier, patterns } of TITLE_TIER_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(jobTitle))) {
      return tier;
    }
  }
  return "UNSPECIFIED";
}

function scopeSearchableText(job: Job): string {
  return [job.jobDescription, job.responsibilities.join(" "), job.requirements.join(" ")].join(" ");
}

/**
 * Deterministic, title+responsibilities-based scope score (Phase 8.5.5 §3) —
 * never Claude-driven. Title tier sets the base; strong/weak scope-signal
 * counts in the description/responsibilities/requirements move it within a
 * bounded range, so e.g. a "Senior" title with strong architecture/
 * ownership language scores meaningfully higher than a "Senior" title
 * dominated by manual-execution language, without either ever overriding
 * what the title itself signals.
 */
export function evaluateSeniorityScope(job: Job): SeniorityScopeResult {
  const titleTier = detectTitleTier(job.jobTitle);
  const text = scopeSearchableText(job);

  const strongSignalCount = STRONG_SCOPE_SIGNALS.filter((pattern) => pattern.test(text)).length;
  const weakSignalCount = WEAK_SCOPE_SIGNALS.filter((pattern) => pattern.test(text)).length;

  const adjustment =
    Math.min(strongSignalCount, MAX_SIGNAL_ADJUSTMENT_STEPS) * SIGNAL_ADJUSTMENT_PER_STEP -
    Math.min(weakSignalCount, MAX_SIGNAL_ADJUSTMENT_STEPS) * SIGNAL_ADJUSTMENT_PER_STEP;

  const score = Math.max(0, Math.min(100, TIER_BASE_SCORE[titleTier] + adjustment));

  let scopeLabel: ScopeLabel = "NEUTRAL";
  if (strongSignalCount > weakSignalCount && strongSignalCount > 0) {
    scopeLabel = "HIGH_SCOPE";
  } else if (weakSignalCount > strongSignalCount && weakSignalCount > 0) {
    scopeLabel = "EXECUTION_FOCUSED";
  }

  return { titleTier, scopeLabel, score, strongSignalCount, weakSignalCount };
}

/**
 * Location eligibility as a ranking factor (Phase 8.5.5 §2/§8) — distinct
 * from locationEligibilityFilter.ts's isLocationEligible(), which is a
 * pass/fail pre-Claude gate (unmodified). By the time ranking runs, a job
 * has already passed that gate, so this only ever differentiates AMONG
 * already-eligible jobs (e.g. Islamabad/Dubai/Abu Dhabi onsite over a
 * different eligible Pakistan/UAE city; worldwide-remote over an
 * unclear-scope remote listing).
 */
export function scoreLocationEligibilityForRanking(job: Job): number {
  if (job.remoteStatus !== "REMOTE") {
    const location = job.location.trim().toLowerCase();
    const isPreferredCity = ["islamabad", "dubai", "abu dhabi"].some((city) => location.includes(city));
    return isPreferredCity ? 100 : 80;
  }

  const classification = classifyRemoteEligibility(job);
  if (classification === "REMOTE_PK_ELIGIBLE") {
    return 90;
  }
  if (classification === "REMOTE_UNCLEAR") {
    return 60;
  }
  return 0; // REMOTE_EXCLUDED — should already have been filtered pre-Claude; safe fallback only.
}

/** Neutral fallback when datePosted can't be parsed — never lets an unparseable date silently zero out the whole strategic score. */
const NEUTRAL_FRESHNESS_SCORE = 50;

/** Qualitative priority weighting (Phase 8.5.5 §8) — NOT a claim that Claude or any code computes a literal weighted sum elsewhere; this is plain deterministic arithmetic over already-produced scores (CLAUDE.md rule 7). */
const STRATEGIC_WEIGHTS = {
  careerRelevance: 0.25,
  matchScore: 0.2,
  seniorityScope: 0.2,
  interviewPotential: 0.1,
  careerGrowth: 0.1,
  futureAIValue: 0.05,
  locationEligibility: 0.05,
  freshness: 0.05
} as const;

export interface StrategicRankingResult {
  score: number;
  scope: SeniorityScopeResult;
  locationScore: number;
  freshnessScore: number;
  /** Short, deterministic, Claude-free explanation for the shortlist (Phase 8.5.5 §15) — never exposes prompt content. */
  reason: string;
}

function buildRankingReason(ranked: RankedJob, scope: SeniorityScopeResult): string {
  const parts: string[] = [];

  if (scope.titleTier === "PRINCIPAL_ARCHITECT") {
    parts.push("Principal/Architect-level quality role");
  } else if (scope.titleTier === "STAFF") {
    parts.push("Staff-level quality role");
  } else if (scope.titleTier === "LEAD") {
    parts.push("Lead-level quality role");
  } else if (scope.scopeLabel === "HIGH_SCOPE") {
    parts.push("Senior role with strong architecture/ownership scope");
  } else if (scope.scopeLabel === "EXECUTION_FOCUSED") {
    parts.push("Relevant QA role, but ranked lower due to manual execution scope");
  } else {
    parts.push("Relevant QA role");
  }

  if (ranked.match.careerGrowth >= 70) {
    parts.push("high career growth potential");
  } else if (ranked.match.careerGrowth < 50 && scope.scopeLabel === "EXECUTION_FOCUSED") {
    parts.push("lower career growth");
  }

  if (ranked.match.futureAIValue >= 70) {
    parts.push("strong AI/strategic relevance");
  } else if (scope.scopeLabel === "EXECUTION_FOCUSED" && ranked.match.futureAIValue < 50) {
    parts.push("limited AI/architecture ownership");
  }

  if (scope.titleTier === "SENIOR" && scope.scopeLabel === "EXECUTION_FOCUSED") {
    parts.push("lower seniority alignment for the candidate's target direction");
  }

  return `${parts.join(", ")}.`;
}

export function calculateStrategicRankingScore(ranked: RankedJob): StrategicRankingResult {
  const scope = evaluateSeniorityScope(ranked.job);
  const locationScore = scoreLocationEligibilityForRanking(ranked.job);
  const freshnessScore = computeFreshnessScore(ranked.job) ?? NEUTRAL_FRESHNESS_SCORE;
  // Every job reaching this function has already passed the Career
  // Relevance Gate, which requires careerRelevanceScore to be a defined
  // number >= 70 — the fallback below is a type-safety net only, never
  // expected to actually trigger.
  const careerRelevance = ranked.match.careerRelevanceScore ?? 0;

  const score =
    careerRelevance * STRATEGIC_WEIGHTS.careerRelevance +
    ranked.match.matchScore * STRATEGIC_WEIGHTS.matchScore +
    scope.score * STRATEGIC_WEIGHTS.seniorityScope +
    ranked.match.interviewPotential * STRATEGIC_WEIGHTS.interviewPotential +
    ranked.match.careerGrowth * STRATEGIC_WEIGHTS.careerGrowth +
    ranked.match.futureAIValue * STRATEGIC_WEIGHTS.futureAIValue +
    locationScore * STRATEGIC_WEIGHTS.locationEligibility +
    freshnessScore * STRATEGIC_WEIGHTS.freshness;

  return {
    score: Math.round(score),
    scope,
    locationScore,
    freshnessScore,
    reason: buildRankingReason(ranked, scope)
  };
}
