import type { JobSource, RawProviderJob } from "./jobSource.js";
import type { SearchCriteria } from "../schemas/searchCriteria.js";
import { env } from "../config/env.js";
import { JobSourceAuthError, JobSourceUnavailableError } from "../utils/errors.js";

/**
 * Careerjet adapter — PLACEHOLDER (Phase 8.5). Careerjet's job search API is
 * a real, documented partner API, but it requires an approved affiliate
 * account and API key (CAREERJET_API_KEY / CAREERJET_AFFILIATE_ID in
 * env.ts) which are not configured in this environment. `searchJobs()`
 * intentionally throws until real credentials are obtained — never an
 * undocumented/scraped call, never an invented credential.
 *
 * `normalize()` is fully implemented against a REASONABLE PLACEHOLDER raw
 * shape (typical of Careerjet's documented affiliate feed fields), ready in
 * advance — this raw shape MUST be verified/adjusted against the real API
 * once credentials exist.
 */
export interface CareerjetRawJob extends RawProviderJob {
  jobId?: string;
  title?: string;
  company?: string;
  locations?: string;
  description?: string;
  date?: string; // ISO date string
  url?: string; // Careerjet's own affiliate-tracked listing URL
  salary?: string; // free text, e.g. "AED 15,000 - 20,000"
}

export function normalizeCareerjetJob(raw: CareerjetRawJob): unknown | null {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const company = typeof raw.company === "string" ? raw.company.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const jobId = typeof raw.jobId === "string" ? raw.jobId.trim() : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const location = typeof raw.locations === "string" && raw.locations.trim().length > 0 ? raw.locations.trim() : "";
  const country = location.includes(",") ? location.split(",").slice(-1)[0].trim() : location;
  const datePosted = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.date) ? raw.date.slice(0, 10) : "";

  if (!title || !company || !url || !jobId || description.length < 20 || !location || !country || !datePosted) {
    return null;
  }

  return {
    jobTitle: title,
    company,
    location,
    country,
    remoteStatus: "ONSITE", // Careerjet's placeholder shape doesn't expose a remote flag — never assumed.
    employmentType: "FULL_TIME", // Careerjet's documented feed doesn't reliably distinguish employment type in this placeholder shape.
    jobDescription: description,
    requirements: [description],
    responsibilities: [description],
    skills: [title],
    source: "careerjet",
    sourceUrl: url,
    datePosted,
    externalJobId: jobId
  };
}

export function createCareerjetJobSource(): JobSource {
  return {
    name: "careerjet",

    async searchJobs(_criteria: SearchCriteria): Promise<RawProviderJob[]> {
      if (!env.careerjetApiKey || !env.careerjetAffiliateId) {
        throw new JobSourceAuthError(
          "Careerjet integration requires CAREERJET_API_KEY and CAREERJET_AFFILIATE_ID, which are not configured (see docs/JOB_SOURCES.md)."
        );
      }
      // Even with credentials present, no live call is made here — this
      // adapter has not been exercised against Careerjet's real API (no live
      // job-source calls were authorized during Phase 8.5 implementation).
      throw new JobSourceUnavailableError(
        "Careerjet integration is not yet wired to a live request — see docs/JOB_SOURCES.md for what's required before enabling this in production."
      );
    },

    async getJob(_jobId: string): Promise<RawProviderJob | null> {
      return null;
    },

    normalize(raw: RawProviderJob): unknown | null {
      return normalizeCareerjetJob(raw as CareerjetRawJob);
    }
  };
}
