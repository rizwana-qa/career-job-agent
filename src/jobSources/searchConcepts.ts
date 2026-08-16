/**
 * Centralized, small, controlled query configuration for multi-source
 * discovery (Phase 8.4 §6, extended by Phase 8.5 §5's final career search
 * specification) — a bounded set of search concepts and target locations,
 * not hundreds of per-keyword combinations. Any future adapter that builds
 * real query parameters (see indeedJobSource.ts, careerjetJobSource.ts,
 * etc.) should read from this module rather than inventing its own list, so
 * the query surface stays centralized and auditable in one place.
 *
 * Remotive (and the other single-feed sources — Remote OK, We Work
 * Remotely) are intentionally excluded from this fan-out: they already
 * perform one unfiltered/category-filtered call each, and role narrowing
 * happens deterministically downstream — that existing, rate-limit-
 * respecting design is unchanged by Phase 8.5.
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
