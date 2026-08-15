import type { JobSource, RawProviderJob } from "./jobSource.js";
import type { SearchCriteria } from "../schemas/searchCriteria.js";
import { JobSourceUnavailableError } from "../utils/errors.js";

/**
 * Indeed adapter — PLACEHOLDER (Phase 8.4). See docs/JOB_SOURCES.md → Source
 * Access Review: Indeed has no general-purpose public job-search API open to
 * new third-party integrations today. Its historical Publisher/Job Search
 * API stopped accepting new registrations years ago; current documented
 * access (XML feed / Indeed Apply sync) is gated behind an approved
 * employer/ATS partnership, not a simple API key. This adapter therefore
 * implements the JobSource contract but `searchJobs()` intentionally throws
 * until real, documented, credentialed access is obtained — never an
 * undocumented/scraped call, per Phase 8.4's explicit instruction.
 *
 * `normalize()` is fully implemented against a REASONABLE PLACEHOLDER raw
 * shape (typical of Indeed's historically documented feed fields), so
 * normalization logic and its tests are ready in advance — this raw shape
 * MUST be verified/adjusted against the real API once partner access exists.
 */
export interface IndeedRawJob extends RawProviderJob {
  jobkey?: string;
  jobtitle?: string;
  company?: string;
  formattedLocation?: string;
  city?: string;
  country?: string;
  snippet?: string;
  url?: string;
  date?: string; // ISO date string, e.g. "2026-08-10"
  jobType?: string; // "fulltime" | "parttime" | "contract" | "internship"
  salary?: string; // free text, e.g. "$70,000 - $90,000 a year"
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  fulltime: "FULL_TIME",
  parttime: "PART_TIME",
  contract: "CONTRACT",
  freelance: "FREELANCE",
  internship: "INTERNSHIP"
};

function parseSalary(raw: string | undefined): { salary?: number; currency?: string } {
  if (!raw || !raw.includes("$")) {
    return {};
  }
  const numbers = raw.match(/[\d,]+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) {
    return {};
  }
  const values = numbers.map((n) => Number(n.replace(/,/g, ""))).filter((n) => Number.isFinite(n) && n > 0);
  if (values.length === 0) {
    return {};
  }
  const salary = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return { salary, currency: "USD" };
}

export function normalizeIndeedJob(raw: IndeedRawJob): unknown | null {
  const jobType = typeof raw.jobType === "string" ? raw.jobType.toLowerCase() : "";
  const employmentType = EMPLOYMENT_TYPE_MAP[jobType];
  if (!employmentType) {
    return null;
  }

  const title = typeof raw.jobtitle === "string" ? raw.jobtitle.trim() : "";
  const company = typeof raw.company === "string" ? raw.company.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const jobkey = typeof raw.jobkey === "string" ? raw.jobkey.trim() : "";
  const description = typeof raw.snippet === "string" ? raw.snippet.trim() : "";
  const country = typeof raw.country === "string" && raw.country.trim().length > 0 ? raw.country.trim() : "";
  const location = typeof raw.formattedLocation === "string" && raw.formattedLocation.trim().length > 0
    ? raw.formattedLocation.trim()
    : typeof raw.city === "string"
      ? raw.city.trim()
      : "";
  const datePosted = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : "";

  if (!title || !company || !url || !jobkey || description.length < 20 || !country || !location || !datePosted) {
    return null;
  }

  const { salary, currency } = parseSalary(raw.salary);

  return {
    jobTitle: title,
    company,
    location,
    country,
    remoteStatus: "ONSITE", // Indeed listings are location-anchored by default in this placeholder shape — a real integration should read a genuine remote flag if the API exposes one, never assume.
    employmentType,
    jobDescription: description,
    requirements: [description],
    responsibilities: [description],
    skills: [title],
    source: "indeed",
    sourceUrl: url,
    datePosted,
    ...(salary !== undefined ? { salary, currency } : {}),
    externalJobId: jobkey
  };
}

export function createIndeedJobSource(): JobSource {
  return {
    name: "indeed",

    async searchJobs(_criteria: SearchCriteria): Promise<RawProviderJob[]> {
      throw new JobSourceUnavailableError(
        "Indeed integration is not yet available: no documented public job-search API is open to new third-party integrations (see docs/JOB_SOURCES.md). Requires an approved employer/ATS partnership before this can go live."
      );
    },

    async getJob(_jobId: string): Promise<RawProviderJob | null> {
      return null;
    },

    normalize(raw: RawProviderJob): unknown | null {
      return normalizeIndeedJob(raw as IndeedRawJob);
    }
  };
}
