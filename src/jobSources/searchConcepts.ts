/**
 * Centralized, small, controlled query configuration for multi-source
 * discovery (Phase 8.4 §6) — a bounded set of search concepts and target
 * locations, not hundreds of per-keyword combinations. Any future adapter
 * that builds real query parameters (see indeedJobSource.ts,
 * naukrigulfJobSource.ts, gulfTalentJobSource.ts) should read from this
 * module rather than inventing its own list, so the query surface stays
 * centralized and auditable in one place.
 *
 * Remotive is intentionally excluded from this fan-out: its adapter already
 * performs one category-filtered call (see remotiveJobSource.ts) and role
 * narrowing happens deterministically downstream — that existing,
 * rate-limit-respecting design is unchanged by Phase 8.4.
 */
export const CAREER_SEARCH_CONCEPTS: readonly string[] = [
  "QA",
  "Software Quality",
  "SDET",
  "Test Automation",
  "QA Architect",
  "Quality Engineer",
  "AI Quality"
];

export const TARGET_SEARCH_LOCATIONS: readonly string[] = ["Islamabad", "Pakistan", "Dubai", "Abu Dhabi", "UAE"];
