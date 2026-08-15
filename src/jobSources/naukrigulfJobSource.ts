import type { JobSource, RawProviderJob } from "./jobSource.js";
import type { SearchCriteria } from "../schemas/searchCriteria.js";
import { JobSourceUnavailableError } from "../utils/errors.js";

/**
 * Naukrigulf adapter — PLACEHOLDER (Phase 8.4). See docs/JOB_SOURCES.md →
 * Source Access Review: no documented public job-search API for third-party
 * consumption was found for Naukrigulf. Its public-facing integrations are
 * recruiter/employer-side (posting jobs, ATS sync via Naukri RMS), not a
 * candidate-search API for external applications. `searchJobs()`
 * intentionally throws until documented, credentialed access is confirmed
 * and obtained — never an undocumented/scraped call.
 *
 * `normalize()` is fully implemented against a REASONABLE PLACEHOLDER raw
 * shape (typical of Naukri-family JSON job listings), ready in advance —
 * this raw shape MUST be verified/adjusted against the real API once access
 * exists.
 */
export interface NaukrigulfRawJob extends RawProviderJob {
  jobId?: string;
  title?: string;
  companyName?: string;
  location?: string; // e.g. "Dubai, UAE"
  country?: string;
  jobDescription?: string;
  employmentType?: string; // "Full Time" | "Part Time" | "Contract" | "Freelance" | "Internship"
  salaryDetail?: { minimumSalary?: number; maximumSalary?: number; currency?: string };
  createdDate?: string; // ISO date string
  jdURL?: string;
  isRemote?: boolean;
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  "full time": "FULL_TIME",
  "part time": "PART_TIME",
  contract: "CONTRACT",
  freelance: "FREELANCE",
  internship: "INTERNSHIP"
};

export function normalizeNaukrigulfJob(raw: NaukrigulfRawJob): unknown | null {
  const employmentTypeKey = typeof raw.employmentType === "string" ? raw.employmentType.trim().toLowerCase() : "";
  const employmentType = EMPLOYMENT_TYPE_MAP[employmentTypeKey];
  if (!employmentType) {
    return null;
  }

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const company = typeof raw.companyName === "string" ? raw.companyName.trim() : "";
  const url = typeof raw.jdURL === "string" ? raw.jdURL.trim() : "";
  const jobId = typeof raw.jobId === "string" ? raw.jobId.trim() : "";
  const description = typeof raw.jobDescription === "string" ? raw.jobDescription.trim() : "";
  const location = typeof raw.location === "string" ? raw.location.trim() : "";
  const country = typeof raw.country === "string" && raw.country.trim().length > 0
    ? raw.country.trim()
    : location.includes(",")
      ? location.split(",").slice(-1)[0].trim()
      : location;
  const datePosted = typeof raw.createdDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.createdDate) ? raw.createdDate : "";

  if (!title || !company || !url || !jobId || description.length < 20 || !location || !country || !datePosted) {
    return null;
  }

  const salaryDetail = raw.salaryDetail;
  const salary =
    salaryDetail && typeof salaryDetail.minimumSalary === "number" && typeof salaryDetail.maximumSalary === "number"
      ? Math.round((salaryDetail.minimumSalary + salaryDetail.maximumSalary) / 2)
      : undefined;
  const currency = salary !== undefined && typeof salaryDetail?.currency === "string" ? salaryDetail.currency : undefined;

  return {
    jobTitle: title,
    company,
    location,
    country,
    remoteStatus: raw.isRemote === true ? "REMOTE" : "ONSITE",
    employmentType,
    jobDescription: description,
    requirements: [description],
    responsibilities: [description],
    skills: [title],
    source: "naukrigulf",
    sourceUrl: url,
    datePosted,
    ...(salary !== undefined && currency ? { salary, currency } : {}),
    externalJobId: jobId
  };
}

export function createNaukrigulfJobSource(): JobSource {
  return {
    name: "naukrigulf",

    async searchJobs(_criteria: SearchCriteria): Promise<RawProviderJob[]> {
      throw new JobSourceUnavailableError(
        "Naukrigulf integration is not yet available: no documented public job-search API for third-party consumption was found (see docs/JOB_SOURCES.md). Requires confirming and obtaining a legitimate access method before this can go live."
      );
    },

    async getJob(_jobId: string): Promise<RawProviderJob | null> {
      return null;
    },

    normalize(raw: RawProviderJob): unknown | null {
      return normalizeNaukrigulfJob(raw as NaukrigulfRawJob);
    }
  };
}
