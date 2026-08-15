import type { Job } from "../schemas/job.js";

/**
 * Location eligibility gate (Phase 8.4 §4/§11) — deterministic, pre-Claude,
 * scoped to POST /career/discover-match only. Distinct from
 * jobFilterService.ts's existing allowedCountries/allowRemoteAnyCountry
 * logic (used by /career/run and /jobs/discover via job_preferences.md) —
 * that logic is untouched; this is a separate, additive check composed
 * alongside the Career Relevance Gate's hard negative filter at the
 * discover-match route's own call site (see careerDiscoverMatch.ts).
 *
 * A REMOTE job is never rejected here, regardless of its listed country —
 * "worldwide remote" roles are explicitly preserved (Phase 8.4 §4) so later,
 * more nuanced filtering (deterministic or Claude-driven) can still decide
 * Pakistan eligibility. HYBRID/ONSITE roles are only eligible when their
 * country or city matches the configured target list.
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

export function isLocationEligible(job: Job, config: LocationEligibilityConfig = DEFAULT_LOCATION_ELIGIBILITY_CONFIG): boolean {
  if (job.remoteStatus === "REMOTE") {
    return true;
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
