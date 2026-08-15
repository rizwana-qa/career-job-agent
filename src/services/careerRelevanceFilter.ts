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

/**
 * Positive pre-Claude career relevance prefilter (Phase 8.3.3).
 *
 * Production logs showed obviously unrelated postings ("Remote Office
 * Assistant", "Face Deduplication Collection") reaching Claude matching and
 * only getting rejected afterward — the hard negative filter above only
 * catches a specific known list of IT-support-shaped titles, not the much
 * wider space of clearly-unrelated roles. This is a second, complementary
 * deterministic pre-Claude guard: a job's title (or, for ambiguous titles, a
 * combination of description-level signals) must show a positive QA/
 * testing/automation/AI-quality signal before it's worth a Claude call.
 *
 * Three tiers, checked in order:
 * 1. STRONG_POSITIVE_TITLE_PATTERNS — the title itself is unambiguously a
 *    target-family role (QA Engineer, SDET, Quality Architect, etc. and
 *    their seniority variants) — passes immediately, no description check.
 * 2. AMBIGUOUS_TITLE_PATTERNS — broad titles (Software Engineer, Technical
 *    Lead, AI Engineer, Engineering Manager, Automation Engineer) that may
 *    or may not carry real QA/testing responsibilities. These are NEVER
 *    rejected here — per Phase 8.3.3 §4, a broad title alone is not grounds
 *    for pre-Claude rejection; Claude's semantic judgment decides.
 * 3. Everything else — the title is not explicitly QA-shaped and not one of
 *    the recognized ambiguous titles, so it only passes if the job
 *    description/skills/responsibilities/requirements show a REASONABLE
 *    COMBINATION of secondary signals (>= SECONDARY_SIGNAL_MIN_COUNT
 *    distinct matches) — a single incidental keyword mention is never
 *    enough (Phase 8.3.3 §2's explicit requirement).
 *
 * This never replaces or weakens passesCareerRelevanceGate() (the final,
 * Claude-scored gate in careerDiscoverMatch.ts) — it only decides whether a
 * job is worth sending to Claude at all.
 */
const STRONG_POSITIVE_TITLE_PATTERNS: RegExp[] = [
  // Broad "QA" catch-all — deliberately covers title variants beyond section
  // 1's literal list (QA Lead, QA Manager, QA Specialist, QA Automation
  // Lead, etc.). Safe specifically because this checks the TITLE, not the
  // description: "QA" appearing as a standalone word in a job title is
  // overwhelmingly a genuine QA-family signal (unlike an incidental mention
  // buried in a description), and the hard negative title filter still runs
  // independently before this — a title matching both would already have
  // been rejected there.
  /\bqa\b/i,
  /\bqa\s*engineer\b/i,
  /\bquality\s*engineer\b/i,
  /\bquality\s*assurance\b/i,
  /\bsoftware\s*quality\b/i,
  /\bsdet\b/i,
  /\btest\s*automation\b/i,
  /\bautomation\s*engineer\b/i,
  /\bqa\s*architect\b/i,
  /\bquality\s*engineering\b/i,
  /\bsoftware\s*test\s*engineer\b/i,
  /\bai\s*test\s*engineer\b/i,
  /\bai\s*qa\b/i,
  /\bllm\s*testing\b/i,
  /\brag\s*testing\b/i,
  /\bai\s*agent\s*testing\b/i,
  /\btest\s*architect\b/i,
  /\bautomation\s*architect\b/i
];

/** Broad titles that must never be pre-Claude-rejected on title alone — see tier 2 above. */
const AMBIGUOUS_TITLE_PATTERNS: RegExp[] = [
  /\bsoftware\s*engineer\b/i,
  /\bengineering\s*manager\b/i,
  /\btechnical\s*lead\b/i,
  /\bai\s*engineer\b/i,
  /\bautomation\s*engineer\b/i
];

interface SecondarySignal {
  label: string;
  pattern: RegExp;
}

/** Description/skills-level fallback signals — see tier 3 above. Matched against description+skills+responsibilities+requirements, never title alone. */
const SECONDARY_SKILL_SIGNALS: SecondarySignal[] = [
  { label: "Playwright", pattern: /\bplaywright\b/i },
  { label: "Selenium", pattern: /\bselenium\b/i },
  { label: "Cypress", pattern: /\bcypress\b/i },
  { label: "API Testing", pattern: /\bapi\s*testing\b/i },
  { label: "Postman", pattern: /\bpostman\b/i },
  { label: "REST API", pattern: /\brest\s*api\b/i },
  { label: "Automation Framework", pattern: /\bautomation\s*framework\b/i },
  { label: "Test Automation", pattern: /\btest\s*automation\b/i },
  { label: "Performance Testing", pattern: /\bperformance\s*testing\b/i },
  { label: "Load Testing", pattern: /\bload\s*testing\b/i },
  { label: "Quality Engineering", pattern: /\bquality\s*engineering\b/i },
  { label: "Software Testing", pattern: /\bsoftware\s*testing\b/i },
  { label: "LLM", pattern: /\bllm\b/i },
  { label: "RAG", pattern: /\brag\b/i },
  { label: "AI Testing", pattern: /\bai\s*testing\b/i },
  { label: "AI Agents", pattern: /\bai\s*agents?\b/i },
  { label: "AI Quality", pattern: /\bai\s*quality\b/i },
  { label: "Test Strategy", pattern: /\btest\s*strategy\b/i },
  { label: "CI/CD Testing", pattern: /\bci\s*\/?\s*cd\s*testing\b/i }
];

/** A single incidental keyword is never enough (Phase 8.3.3 §2) — this many DISTINCT secondary signals must appear before an ambiguously-titled job passes on description alone. */
export const SECONDARY_SIGNAL_MIN_COUNT = 2;

export type CareerSignalStrength = "STRONG_TITLE" | "AMBIGUOUS_TITLE" | "SECONDARY_SIGNALS" | "NONE";

export interface CareerSignalResult {
  passes: boolean;
  strength: CareerSignalStrength;
  /** Only present when strength === "SECONDARY_SIGNALS". */
  matchedSecondarySignals?: string[];
}

function jobSearchableText(job: Job): string {
  return [job.jobDescription, job.skills.join(" "), job.responsibilities.join(" "), job.requirements.join(" ")].join(" ");
}

/** Full result, including which tier a job passed on (or that it passed none) — used for logging and tests. */
export function evaluateCareerSignal(job: Job): CareerSignalResult {
  if (STRONG_POSITIVE_TITLE_PATTERNS.some((pattern) => pattern.test(job.jobTitle))) {
    return { passes: true, strength: "STRONG_TITLE" };
  }
  if (AMBIGUOUS_TITLE_PATTERNS.some((pattern) => pattern.test(job.jobTitle))) {
    return { passes: true, strength: "AMBIGUOUS_TITLE" };
  }

  const searchableText = jobSearchableText(job);
  const matchedSecondarySignals = SECONDARY_SKILL_SIGNALS.filter((signal) => signal.pattern.test(searchableText)).map(
    (signal) => signal.label
  );
  if (matchedSecondarySignals.length >= SECONDARY_SIGNAL_MIN_COUNT) {
    return { passes: true, strength: "SECONDARY_SIGNALS", matchedSecondarySignals };
  }

  return { passes: false, strength: "NONE" };
}

/** Convenience boolean wrapper around evaluateCareerSignal() — used as the actual preMatchFilter predicate. */
export function hasPositiveCareerSignal(job: Job): boolean {
  return evaluateCareerSignal(job).passes;
}
