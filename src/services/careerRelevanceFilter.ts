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
 *    or may not carry real QA/testing responsibilities. As of Phase 8.5.9
 *    §8, the title alone is no longer sufficient — these fall through to
 *    the SAME bounded secondary-signal combination check as tier 3 below
 *    (title alone used to pass immediately; that let e.g. a "Principal
 *    Software Engineer" with zero real QA ownership reach Claude and even
 *    get search-tier-classified as TIER_1 purely from the word "Principal" —
 *    see Phase 8.5.8's diagnosis). The distinction from tier 3 is only in
 *    the reported `strength` ("AMBIGUOUS_TITLE" vs "SECONDARY_SIGNALS").
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
  /\bautomation\s*architect\b/i,
  // Phase 8.5.14 §2 — SQA (Software Quality Assurance) is a legitimate,
  // widely-used software-QA abbreviation, distinct from bare "QC"/"Quality
  // Control" (see AMBIGUOUS_TITLE_PATTERNS below) — real Himalayas data
  // observed via Phase 8.5.11/8.5.13 included "SQA Engineer" titles that
  // this list didn't recognize even though searchTierClassifier.ts already
  // treated \bsqa\b as a quality-family signal since Phase 8.5.9.
  /\bsqa\b/i,
  // Phase 8.5.14 §4 — real AI/agent-evaluation title phrasing observed via
  // Phase 8.5.11/8.5.13 ("Agent Quality / Evals Engineer") that didn't match
  // any existing compound AI-quality pattern here (only "AI QA"/"LLM
  // Testing"/"RAG Testing"/"AI Agent Testing" existed). Each of these is a
  // specific compound phrase (never bare "quality" or "AI" alone — see §5),
  // so a generic "AI Engineer"/"AI Researcher"/"Machine Learning Engineer"
  // still does not match any of these.
  /\bagent\s*quality\b/i,
  /\bagent\s*evaluation\b/i,
  /\bagent\s*evals?\b/i,
  /\bai\s*evaluation\b/i,
  /\bai\s*evals?\b/i,
  /\bllm\s*evaluation\b/i,
  /\bmodel\s*evaluation\b/i,
  /\bai\s*model\s*quality\b/i,
  /\bgenai\s*quality\b/i
];

/**
 * Broad titles that must never be pre-Claude-rejected on title alone — see
 * tier 2 above. Phase 8.5.14 §3 adds QC ("Quality Control") here rather
 * than to STRONG_POSITIVE_TITLE_PATTERNS: unlike "QA", "QC" is heavily
 * overloaded with non-software meanings (manufacturing/food/construction/
 * pharma quality control), so a bare "QC"/"Quality Control" title must
 * still clear the SAME bounded secondary-signal combination check as every
 * other ambiguous title before it passes — title alone is never enough for
 * QC (real Himalayas data included a "Senior QC Engineer" title that must
 * only pass when its description actually carries software/testing
 * evidence — see SECONDARY_SKILL_SIGNALS below).
 */
const AMBIGUOUS_TITLE_PATTERNS: RegExp[] = [
  /\bsoftware\s*engineer\b/i,
  /\bengineering\s*manager\b/i,
  /\btechnical\s*lead\b/i,
  /\bai\s*engineer\b/i,
  /\bautomation\s*engineer\b/i,
  /\bqc\b/i,
  /\bquality\s*control\b/i
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
  { label: "CI/CD Testing", pattern: /\bci\s*\/?\s*cd\s*testing\b/i },
  // Phase 8.5.14 §7 — the additional software-context signals needed to
  // give an ambiguous title (Software Engineer, QC, Quality Control, etc.)
  // a fair chance to pass on real description evidence, matching the
  // explicit list requested for QC/Quality-Control-style contextual checks.
  { label: "QA", pattern: /\bqa\b/i },
  { label: "SQA", pattern: /\bsqa\b/i },
  { label: "SDET", pattern: /\bsdet\b/i },
  { label: "Test Architecture", pattern: /\btest\s*architecture\b/i },
  { label: "Software Quality", pattern: /\bsoftware\s*quality\b/i },
  { label: "Functional Testing", pattern: /\bfunctional\s*testing\b/i },
  { label: "Regression Testing", pattern: /\bregression\s*testing\b/i },
  { label: "Integration Testing", pattern: /\bintegration\s*testing\b/i },
  { label: "LLM Evaluation", pattern: /\bllm\s*evaluation\b/i },
  { label: "Agent Testing", pattern: /\bagent\s*testing\b/i }
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

/**
 * Full result, including which tier a job passed on (or that it passed
 * none) — used for logging and tests.
 *
 * Phase 8.5.9 §8: AMBIGUOUS_TITLE_PATTERNS ("Software Engineer", "AI
 * Engineer", "Technical Lead", "Engineering Manager", "Automation Engineer")
 * used to pass IMMEDIATELY on title alone, with no description check at
 * all — the Phase 8.5.8 diagnosis identified this as the likely mechanism by
 * which a title like "Principal Software Engineer" (no real QA ownership)
 * could reach Claude and even get classified TIER_1 by searchTier purely
 * from the word "Principal". This is now gated behind the SAME bounded
 * combination requirement already used for unrecognized titles
 * (>= SECONDARY_SIGNAL_MIN_COUNT distinct secondary signals in the
 * description/skills/responsibilities/requirements) — an ambiguous title is
 * no longer sufficient by itself. This makes the filter STRICTER, not
 * weaker: nothing that used to fail now passes, and the "AMBIGUOUS_TITLE"
 * strength label is preserved for jobs whose ambiguous title is reinforced
 * by real signals, distinct from "SECONDARY_SIGNALS" (an unrecognized title
 * saved entirely by description-level evidence).
 */
export function evaluateCareerSignal(job: Job): CareerSignalResult {
  if (STRONG_POSITIVE_TITLE_PATTERNS.some((pattern) => pattern.test(job.jobTitle))) {
    return { passes: true, strength: "STRONG_TITLE" };
  }

  const isAmbiguousTitle = AMBIGUOUS_TITLE_PATTERNS.some((pattern) => pattern.test(job.jobTitle));
  const searchableText = jobSearchableText(job);
  const matchedSecondarySignals = SECONDARY_SKILL_SIGNALS.filter((signal) => signal.pattern.test(searchableText)).map(
    (signal) => signal.label
  );
  if (matchedSecondarySignals.length >= SECONDARY_SIGNAL_MIN_COUNT) {
    return { passes: true, strength: isAmbiguousTitle ? "AMBIGUOUS_TITLE" : "SECONDARY_SIGNALS", matchedSecondarySignals };
  }

  return { passes: false, strength: "NONE" };
}

/** Convenience boolean wrapper around evaluateCareerSignal() — used as the actual preMatchFilter predicate. */
export function hasPositiveCareerSignal(job: Job): boolean {
  return evaluateCareerSignal(job).passes;
}

/**
 * Non-software-QA filter (Phase 8.5 §8) — a NEW, additive guard, composed
 * alongside isHardNegativeRole()/hasPositiveCareerSignal() at the
 * discover-match route's call site (see careerDiscoverMatch.ts). Neither of
 * those two existing functions is modified by this addition.
 *
 * Catches titles that superficially contain "QA"/"quality"/"AI" (so they'd
 * otherwise pass the positive prefilter's broad `\bqa\b` title match) but
 * belong to a fundamentally different QA discipline than software quality
 * engineering: food/manufacturing/construction/textile/warehouse QA-QC,
 * pharma/medical-device QMS, NDT inspection, calibration, oil & gas
 * inspection, and call-center/BPO "Quality Analyst" roles. These are
 * unconditionally rejected — there is no software-QA reading of them.
 *
 * Phase 8.5.14 §8: the industry-vs-quality-word check below is
 * ORDER-INDEPENDENT (co-occurrence, not a single fixed-adjacency regex) —
 * real Himalayas titles reverse the word order this filter originally
 * assumed ("QC Inspector, Manufacturing" and "Quality Control Engineer,
 * Construction" put the industry word AFTER the quality word, often
 * comma-separated), which the original "industry + qa/qc/quality" adjacency
 * patterns missed entirely.
 *
 * AI-labeling roles (AI Trainer, AI Data Annotator, RLHF Rater, Data
 * Labeling, AI microtask work) are rejected UNLESS the title also carries a
 * genuine software-QA-engineering signal (STRONG_POSITIVE_TITLE_PATTERNS
 * tier 1 above) — per Phase 8.5 §8's explicit exception ("unless the job is
 * genuinely an engineering role with software quality ownership").
 */
const NON_SOFTWARE_INDUSTRY_TITLE_WORDS: RegExp[] = [
  /\bfood\b/i,
  /\bmanufacturing\b/i,
  /\bconstruction\b/i,
  /\btextile\b/i,
  /\bwarehouse\b/i,
  /\boil\s*(and|&)\s*gas\b/i
];

const QUALITY_DISCIPLINE_TITLE_WORDS: RegExp[] = [/\bqa\b/i, /\bqc\b/i, /\bquality\b/i];

/** True when the title contains BOTH a non-software-industry word and a QA/QC/quality word, anywhere in the title, regardless of order or punctuation. */
function hasNonSoftwareIndustryQualityCoOccurrence(title: string): boolean {
  return NON_SOFTWARE_INDUSTRY_TITLE_WORDS.some((pattern) => pattern.test(title)) && QUALITY_DISCIPLINE_TITLE_WORDS.some((pattern) => pattern.test(title));
}

const NON_SOFTWARE_QA_TITLE_PATTERNS: RegExp[] = [
  /\bpharmaceutical\s*qms\b/i,
  /\bpharma\s*qms\b/i,
  /\bmedical\s*device\s*qms\b/i,
  /\bpharmaceutical\s*quality\s*control\b/i,
  /\bpharma\s*quality\s*control\b/i,
  // "Inspector"/"Auditor" job-function words are, in real-world usage,
  // essentially never applied to software QA/testing roles (which use
  // "Engineer"/"Analyst"/"Tester") — kept unconditional even without a
  // stated industry qualifier.
  /\bndt\s*(quality\s*)?inspect(or|ion)?\b/i,
  /\bqc\s*inspect(or|ion)\b/i,
  /\bcalibration\s*(technician|engineer|specialist)\b/i,
  /\boil\s*(and|&)\s*gas\s*inspect(or|ion)\b/i,
  /\b(call\s*cent(er|re)|bpo)\s*quality\s*analyst\b/i
];

/** Rejected unless the title also matches a genuine software-QA-engineering signal — see the exception in the doc comment above. */
const AI_LABELING_TITLE_PATTERNS: RegExp[] = [
  /\bai\s*trainer\b/i,
  /\bai\s*data\s*annotator\b/i,
  /\bdata\s*annotator\b/i,
  /\brlhf\s*rater\b/i,
  /\bdata\s*labeling\b/i,
  /\bdata\s*labeler\b/i,
  /\bai\s*microtask\b/i
];

export function isNonSoftwareQaRole(job: Job): boolean {
  if (hasNonSoftwareIndustryQualityCoOccurrence(job.jobTitle)) {
    return true;
  }
  if (NON_SOFTWARE_QA_TITLE_PATTERNS.some((pattern) => pattern.test(job.jobTitle))) {
    return true;
  }
  if (AI_LABELING_TITLE_PATTERNS.some((pattern) => pattern.test(job.jobTitle))) {
    const isGenuineSoftwareQaEngineeringRole = STRONG_POSITIVE_TITLE_PATTERNS.some((pattern) => pattern.test(job.jobTitle));
    return !isGenuineSoftwareQaEngineeringRole;
  }
  return false;
}
