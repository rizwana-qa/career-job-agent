import type { JobSource, RawProviderJob } from "./jobSource.js";
import type { SearchCriteria } from "../schemas/searchCriteria.js";
import { JobSourceUnavailableError } from "../utils/errors.js";

/**
 * GulfTalent adapter — PLACEHOLDER (Phase 8.4). See docs/JOB_SOURCES.md →
 * Source Access Review: no documented public job-search API for third-party
 * consumption was found for GulfTalent. `searchJobs()` intentionally throws
 * until documented, credentialed access is confirmed and obtained — never an
 * undocumented/scraped call.
 *
 * `normalize()` is fully implemented against a REASONABLE PLACEHOLDER raw
 * shape (typical of a REST job-board JSON listing), ready in advance — this
 * raw shape MUST be verified/adjusted against the real API once access
 * exists.
 */
export interface GulfTalentRawJob extends RawProviderJob {
  id?: string | number;
  title?: string;
  employer?: { name?: string };
  location?: { city?: string; country?: string };
  description?: string;
  jobType?: string; // "full_time" | "part_time" | "contract" | "freelance" | "internship"
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  postedDate?: string; // ISO date string
  url?: string;
  remote?: boolean;
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACT",
  freelance: "FREELANCE",
  internship: "INTERNSHIP"
};

export function normalizeGulfTalentJob(raw: GulfTalentRawJob): unknown | null {
  const jobType = typeof raw.jobType === "string" ? raw.jobType.trim().toLowerCase() : "";
  const employmentType = EMPLOYMENT_TYPE_MAP[jobType];
  if (!employmentType) {
    return null;
  }

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const company = typeof raw.employer?.name === "string" ? raw.employer.name.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const id = raw.id;
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const city = typeof raw.location?.city === "string" ? raw.location.city.trim() : "";
  const country = typeof raw.location?.country === "string" ? raw.location.country.trim() : "";
  const datePosted = typeof raw.postedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.postedDate) ? raw.postedDate : "";

  if (!title || !company || !url || id === undefined || id === null || description.length < 20 || !country || !datePosted) {
    return null;
  }

  const location = city ? `${city}, ${country}` : country;
  const salary =
    typeof raw.salaryMin === "number" && typeof raw.salaryMax === "number" ? Math.round((raw.salaryMin + raw.salaryMax) / 2) : undefined;
  const currency = salary !== undefined && typeof raw.currency === "string" ? raw.currency : undefined;

  return {
    jobTitle: title,
    company,
    location,
    country,
    remoteStatus: raw.remote === true ? "REMOTE" : "ONSITE",
    employmentType,
    jobDescription: description,
    requirements: [description],
    responsibilities: [description],
    skills: [title],
    source: "gulftalent",
    sourceUrl: url,
    datePosted,
    ...(salary !== undefined && currency ? { salary, currency } : {}),
    externalJobId: String(id)
  };
}

export function createGulfTalentJobSource(): JobSource {
  return {
    name: "gulftalent",

    async searchJobs(_criteria: SearchCriteria): Promise<RawProviderJob[]> {
      throw new JobSourceUnavailableError(
        "GulfTalent integration is not yet available: no documented public job-search API for third-party consumption was found (see docs/JOB_SOURCES.md). Requires confirming and obtaining a legitimate access method before this can go live."
      );
    },

    async getJob(_jobId: string): Promise<RawProviderJob | null> {
      return null;
    },

    normalize(raw: RawProviderJob): unknown | null {
      return normalizeGulfTalentJob(raw as GulfTalentRawJob);
    }
  };
}
