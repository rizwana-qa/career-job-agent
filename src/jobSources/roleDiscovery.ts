/**
 * A maintained, evidence-grounded seed list of role titles to search for —
 * NOT parsed at runtime from career_profile.md/job_preferences.md's "Target
 * Roles" sections, which are free-text positioning paragraphs, not a clean
 * list of literal title strings. This list mirrors that positioning (direct
 * QA/QE roles, AI Quality roles, and adjacent roles genuinely supported by
 * the profile — see research/career_market_discovery_2026-08-14.md, which
 * independently verified these titles exist as real, active job postings).
 *
 * This is a DEFAULT ONLY. Any caller-supplied `criteria.roleKeywords`
 * always overrides it entirely (see jobDiscoveryService.ts) — nothing here
 * is a hardcoded personal preference in the sense CLAUDE.md rule 15 warns
 * against; it's a starting point the caller is free to replace.
 */
export const DEFAULT_ROLE_DISCOVERY_KEYWORDS: readonly string[] = [
  // Direct roles — matches the candidate's current trajectory closely.
  "Principal QA Engineer",
  "Principal Quality Engineer",
  "Staff Quality Engineer",
  "QA Architect",
  "Quality Engineering Architect",
  "Principal SDET",
  "Staff SDET",
  "Quality Engineering Lead",
  "Test Automation Architect",

  // AI quality roles — the candidate's differentiated, current specialization.
  "AI Quality Engineer",
  "AI Test Engineer",
  "AI Evaluation Engineer",
  "LLM Evaluation Engineer",
  "AI Assurance Engineer",
  "AI Quality Architect",
  "AI Testing Lead",
  "AI Agent Quality Engineer",

  // Adjacent roles — included only where the career profile provides real
  // supporting evidence (see career_profile.md → Target Roles / Career
  // Goals); not a high-salary-driven wishlist.
  "Quality Platform Engineer",
  "Engineering Productivity Engineer",
  "Developer Productivity Engineer",
  "AI Reliability Engineer",
  "AI Validation Engineer"
];
