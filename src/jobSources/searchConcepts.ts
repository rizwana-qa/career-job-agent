/**
 * Centralized, small, controlled query configuration for multi-source
 * discovery (Phase 8.4 §6, extended by Phase 8.5 §5's final career search
 * specification, and by Phase 8.5.6's four-tier targeted search strategy) —
 * a bounded set of search concepts and target locations, not hundreds of
 * per-keyword combinations. Any future adapter that builds real query
 * parameters (see indeedJobSource.ts, careerjetJobSource.ts, etc.) should
 * read from this module rather than inventing its own list, so the query
 * surface stays centralized and auditable in one place.
 *
 * Remotive (and the other single-feed sources — Remote OK, We Work
 * Remotely) are intentionally excluded from this fan-out: they already
 * perform one unfiltered/category-filtered call each, and role narrowing
 * happens deterministically downstream — that existing, rate-limit-
 * respecting design is unchanged by Phase 8.5/8.5.6.
 */
export const CAREER_SEARCH_CONCEPTS: readonly string[] = [
  "Principal QA Engineer",
  "Principal Software Quality Engineer",
  "Staff QA Engineer",
  "Staff SDET",
  "Lead QA Engineer",
  "Senior QA Engineer",
  "Quality Engineering",
  "QA Architect",
  "Test Architect",
  "Automation Architect",
  "SDET",
  "Test Automation",
  "AI Quality Engineer",
  "AI Test Engineer",
  "AI QA",
  "LLM Testing",
  "RAG Testing",
  "AI Agent Testing",
  "AI Evals Engineer",
  "LLM Evaluation Engineer",
  "API Test Lead",
  "Performance Test Engineer"
];

/** For sources that support country-level filtering (Phase 8.5 §5). */
export const TARGET_SEARCH_COUNTRIES: readonly string[] = ["Pakistan", "Islamabad", "UAE", "Dubai", "Abu Dhabi"];

/** For remote-only sources — broader regions, never assumed to be Pakistan-eligible without going through locationEligibilityFilter.ts's classification (Phase 8.5 §6). */
export const TARGET_SEARCH_REMOTE_REGIONS: readonly string[] = ["Worldwide", "Asia", "APAC", "Middle East", "Pakistan eligible"];

/** @deprecated Kept for backward compatibility — use TARGET_SEARCH_COUNTRIES / TARGET_SEARCH_REMOTE_REGIONS. */
export const TARGET_SEARCH_LOCATIONS: readonly string[] = ["Islamabad", "Pakistan", "Dubai", "Abu Dhabi", "UAE"];

// ---------------------------------------------------------------------------
// Phase 8.5.6 — four-tier targeted search strategy. Mirrors the tier
// definitions in src/services/searchTierClassifier.ts (which classifies an
// already-discovered Job's title into one of these tiers deterministically,
// never via Claude) — kept here as the query-construction side of the same
// concept, so the two stay obviously in sync for anyone reading either file.
// ---------------------------------------------------------------------------

/** TIER 1 — Executive Technical Quality: highest search priority. */
export const TIER_1_SEARCH_CONCEPTS: readonly string[] = [
  "Principal Software Quality Engineer",
  "Principal QA Engineer",
  "Principal SDET",
  "Staff QA Engineer",
  "Staff Quality Engineer",
  "Staff SDET",
  "QA Architect",
  "Quality Engineering Architect",
  "Test Architect",
  "Automation Architect",
  "Software Quality Architect",
  "Principal Quality Engineer"
];

/** TIER 2 — Leadership + High Scope. */
export const TIER_2_SEARCH_CONCEPTS: readonly string[] = [
  "Lead QA Engineer",
  "Quality Engineering Lead",
  "Lead SDET",
  "SDET Lead",
  "Test Automation Lead",
  "Automation Engineering Lead",
  "QA Engineering Lead",
  "API Test Lead",
  "Test Engineering Lead"
];

/** TIER 3 — Strong Senior Technical: used when Tier 1/2/4 don't provide enough candidates. */
export const TIER_3_SEARCH_CONCEPTS: readonly string[] = [
  "Senior QA Engineer",
  "Senior Software Quality Engineer",
  "Senior SDET",
  "Senior Software Engineer in Test",
  "Senior Test Automation Engineer",
  "Senior API Automation Engineer",
  "Senior Quality Engineer",
  "Senior Test Engineer"
];

/** TIER 4 — Strategic AI Quality: searched explicitly, receives a strategic bonus later via ranking (unchanged), but still must clear the normal career relevance and match gates. */
export const TIER_4_SEARCH_CONCEPTS: readonly string[] = [
  "AI Quality Engineer",
  "AI QA Engineer",
  "AI Test Engineer",
  "AI Quality Assurance Lead",
  "AI Evals Engineer",
  "LLM Evaluation Engineer",
  "LLM Test Engineer",
  "RAG Test Engineer",
  "RAG Quality Engineer",
  "AI Agent Test Engineer",
  "Agent Evaluation Engineer",
  "GenAI QA Engineer",
  "AI Model Quality Engineer"
];

/** Core (non-AI) skill modifiers (Phase 8.5.6 §5) — used selectively, never required for a job to qualify. */
export const CORE_SKILL_MODIFIERS: readonly string[] = [
  "Playwright",
  "TypeScript",
  "Node.js",
  "API testing",
  "automation",
  "test architecture",
  "CI/CD",
  "POM",
  "service object model",
  "performance testing",
  "SQL",
  "quality engineering",
  "test strategy"
];

/** AI-specific skill modifiers (Phase 8.5.6 §5) — used selectively, never required for a job to qualify. */
export const AI_SKILL_MODIFIERS: readonly string[] = [
  "LLM",
  "RAG",
  "AI evaluation",
  "AI testing",
  "agent testing",
  "agentic",
  "evals",
  "LangSmith",
  "DeepEval",
  "RAGAS",
  "promptfoo",
  "MCP",
  "LangGraph"
];

/**
 * Search priority order (Phase 8.5.6 §3): Tier 1 -> Tier 2 -> Tier 4 -> Tier
 * 3. Deliberately NOT Tier 1 -> 2 -> 3 -> 4 — senior leadership/architecture
 * and AI-quality specialization are searched for before generic Senior QA
 * execution roles, per the candidate's own stated career direction
 * (profile/career_profile.md's Target Roles / Career Goals).
 */
export const SEARCH_TIER_CONCEPTS_IN_PRIORITY_ORDER: readonly (readonly string[])[] = [
  TIER_1_SEARCH_CONCEPTS,
  TIER_2_SEARCH_CONCEPTS,
  TIER_4_SEARCH_CONCEPTS,
  TIER_3_SEARCH_CONCEPTS
];

/**
 * Flattens the four tiers, in priority order, into a single ordered role-
 * keyword list — a small, controlled set (not thousands of combinations),
 * per Phase 8.5.6 §4. Used only by POST /career/discover-match's own
 * discoverJobs() call (as an explicit `criteria.roleKeywords` override) —
 * /career/run and /jobs/discover are untouched and keep using
 * DEFAULT_ROLE_DISCOVERY_KEYWORDS (roleDiscovery.ts) via their own,
 * unmodified call sites. A source that reads `roleKeywords[0]` as its
 * primary query term (e.g. Himalayas) therefore naturally searches for a
 * Tier 1 concept first, without any change to the adapter itself.
 */
export function buildTierPrioritizedRoleKeywords(): string[] {
  return SEARCH_TIER_CONCEPTS_IN_PRIORITY_ORDER.flatMap((tierConcepts) => tierConcepts);
}
