import type { Job } from "../schemas/job.js";

/**
 * Location eligibility gate (Phase 8.4 §4/§11, refined by Phase 8.5 §6) —
 * deterministic, pre-Claude, scoped to POST /career/discover-match only.
 * Distinct from jobFilterService.ts's existing allowedCountries/
 * allowRemoteAnyCountry logic (used by /career/run and /jobs/discover via
 * job_preferences.md) — that logic is untouched; this is a separate,
 * additive check composed alongside the Career Relevance Gate's hard
 * negative filter at the discover-match route's own call site (see
 * careerDiscoverMatch.ts).
 *
 * HYBRID/ONSITE roles are only eligible when their country or city matches
 * the configured target list (Pakistan/UAE — a strong role in any Pakistan
 * city may qualify, not just Islamabad, since the country check alone is
 * sufficient; see DEFAULT_LOCATION_ELIGIBILITY_CONFIG). REMOTE roles are
 * classified into three tiers by classifyRemoteEligibility() below, and are
 * only rejected here when definitively REMOTE_EXCLUDED (e.g. "US only",
 * "Canada only", "EU only", "US work authorization required") — an
 * ambiguous or worldwide/Asia/APAC/Middle-East remote listing is never
 * rejected at this deterministic stage.
 */
export interface LocationEligibilityConfig {
  /** Case-insensitive exact match against Job.country. */
  targetCountries: readonly string[];
  /** Case-insensitive substring match against Job.location. */
  targetCityKeywords: readonly string[];
}

/** Pakistan + UAE, per Phase 8.4 §4's explicit target location list. */
export const DEFAULT_LOCATION_ELIGIBILITY_CONFIG: LocationEligibilityConfig = {
  targetCountries: ["Pakistan", "United Arab Emirates", "UAE"],
  targetCityKeywords: ["Islamabad", "Dubai", "Abu Dhabi"]
};

export type RemoteEligibility = "REMOTE_PK_ELIGIBLE" | "REMOTE_UNCLEAR" | "REMOTE_EXCLUDED";

/** Phrases that mean a remote listing is region-restricted to somewhere Pakistan clearly is not (Phase 8.5 §6). Matched against Job.location + Job.country, case-insensitively. */
const REMOTE_EXCLUDED_PHRASES: RegExp[] = [
  /\bus\s*only\b/i,
  /\busa\s*only\b/i,
  /\bunited\s*states\s*only\b/i,
  /\bus\s*(citizens?|residents?)\s*only\b/i,
  /\bus\s*work\s*authoriz(ation|ed)\b/i,
  /\bauthoriz(ed|ation)\s*to\s*work\s*in\s*the\s*us\b/i,
  /\bcanada\s*only\b/i,
  /\bcanadian\s*(citizens?|residents?)\s*only\b/i,
  /\beu\s*only\b/i,
  /\beuropean\s*union\s*only\b/i
];

/** Phrases that clearly indicate Pakistan-eligible remote scope (Phase 8.5 §6) — worldwide, Asia, APAC, Middle East. Deliberately does NOT include bare "EMEA" — see classifyRemoteEligibility(). */
const REMOTE_ELIGIBLE_PHRASES: RegExp[] = [
  /\bworldwide\b/i,
  /\bglobal\b/i,
  /\banywhere\b/i,
  /\bpakistan\b/i,
  /\basia\b/i,
  /\bapac\b/i,
  /\bmiddle\s*east\b/i
];

/**
 * Classifies a REMOTE job's regional scope from its location/country text
 * (Phase 8.5 §6). Deliberately conservative: EMEA is explicitly excluded
 * from REMOTE_ELIGIBLE_PHRASES ("EMEA should remain configurable and should
 * not automatically imply Pakistan eligibility") — an EMEA-scoped listing
 * classifies as REMOTE_UNCLEAR, not REMOTE_PK_ELIGIBLE, and REMOTE_UNCLEAR
 * is never deterministically rejected (only REMOTE_EXCLUDED is) — Claude's
 * semantic judgment is left to decide genuinely ambiguous cases.
 */
export function classifyRemoteEligibility(job: Job): RemoteEligibility {
  const text = `${job.location} ${job.country}`.toLowerCase();

  if (REMOTE_EXCLUDED_PHRASES.some((pattern) => pattern.test(text))) {
    return "REMOTE_EXCLUDED";
  }
  if (REMOTE_ELIGIBLE_PHRASES.some((pattern) => pattern.test(text))) {
    return "REMOTE_PK_ELIGIBLE";
  }
  return "REMOTE_UNCLEAR";
}

export function isLocationEligible(job: Job, config: LocationEligibilityConfig = DEFAULT_LOCATION_ELIGIBILITY_CONFIG): boolean {
  if (job.remoteStatus === "REMOTE") {
    return classifyRemoteEligibility(job) !== "REMOTE_EXCLUDED";
  }

  const country = job.country.trim().toLowerCase();
  if (config.targetCountries.some((target) => target.trim().toLowerCase() === country)) {
    return true;
  }

  const location = job.location.trim().toLowerCase();
  if (config.targetCityKeywords.some((city) => location.includes(city.trim().toLowerCase()))) {
    return true;
  }

  return false;
}
