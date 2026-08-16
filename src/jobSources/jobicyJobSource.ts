import type { JobSource, RawProviderJob } from "./jobSource.js";
import type { SearchCriteria } from "../schemas/searchCriteria.js";
import {
  InvalidJobSourceResponseError,
  JobSourceAuthError,
  JobSourceError,
  JobSourceRateLimitError,
  JobSourceTimeoutError,
  JobSourceUnavailableError
} from "../utils/errors.js";

const JOBICY_API_URL = "https://jobicy.com/api/v2/remote-jobs";
const REQUEST_TIMEOUT_MS = 10_000;
const JOBICY_RESULT_COUNT = 20;

/**
 * Jobicy adapter (Phase 8.5) — public JSON API, no API key required, never
 * scraped. As with the other new sources in this phase, the raw field names
 * below are this codebase's best-effort documented understanding of
 * Jobicy's public feed; verify against a real response before production
 * use — no live call was made to confirm this during implementation.
 */
export interface JobicyJobSourceOptions {
  fetchImpl?: typeof fetch;
}

export interface JobicyRawJob extends RawProviderJob {
  id?: string | number;
  url?: string; // Jobicy's own listing/apply page — the URL Jobicy itself designates as canonical
  jobTitle?: string;
  companyName?: string;
  jobGeo?: string;
  jobType?: string[]; // e.g. ["full-time"]
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string; // ISO date string
  annualSalaryMin?: number;
  annualSalaryMax?: number;
  salaryCurrency?: string;
}

interface JobicyApiResponse {
  jobs: RawProviderJob[];
}

function isJobicyApiResponse(value: unknown): value is JobicyApiResponse {
  return typeof value === "object" && value !== null && Array.isArray((value as { jobs?: unknown }).jobs);
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  "full-time": "FULL_TIME",
  full_time: "FULL_TIME",
  "part-time": "PART_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACT",
  freelance: "FREELANCE",
  internship: "INTERNSHIP"
};

export function normalizeJobicyJob(raw: JobicyRawJob): unknown | null {
  const jobTypeKey = Array.isArray(raw.jobType) && typeof raw.jobType[0] === "string" ? raw.jobType[0].trim().toLowerCase() : "";
  const employmentType = EMPLOYMENT_TYPE_MAP[jobTypeKey];
  if (!employmentType) {
    return null;
  }

  const title = typeof raw.jobTitle === "string" ? raw.jobTitle.trim() : "";
  const company = typeof raw.companyName === "string" ? raw.companyName.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const id = raw.id;
  const description =
    typeof raw.jobDescription === "string" ? raw.jobDescription.trim() : typeof raw.jobExcerpt === "string" ? raw.jobExcerpt.trim() : "";
  const geo = typeof raw.jobGeo === "string" && raw.jobGeo.trim().length > 0 ? raw.jobGeo.trim() : "Worldwide";
  const datePosted = typeof raw.pubDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.pubDate) ? raw.pubDate.slice(0, 10) : "";

  if (!title || !company || !url || id === undefined || id === null || description.length < 20 || !datePosted) {
    return null;
  }

  const salary =
    typeof raw.annualSalaryMin === "number" && typeof raw.annualSalaryMax === "number"
      ? Math.round((raw.annualSalaryMin + raw.annualSalaryMax) / 2)
      : undefined;
  const currency = salary !== undefined && typeof raw.salaryCurrency === "string" ? raw.salaryCurrency : undefined;

  return {
    jobTitle: title,
    company,
    location: geo,
    country: geo,
    remoteStatus: "REMOTE", // Jobicy is exclusively a remote-jobs board.
    employmentType,
    jobDescription: description,
    requirements: [description],
    responsibilities: [description],
    skills: [title],
    source: "jobicy",
    sourceUrl: url,
    datePosted,
    ...(salary !== undefined && currency ? { salary, currency } : {}),
    externalJobId: String(id)
  };
}

export function createJobicyJobSource(options: JobicyJobSourceOptions = {}): JobSource {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "jobicy",

    async searchJobs(criteria: SearchCriteria): Promise<RawProviderJob[]> {
      const url = new URL(JOBICY_API_URL);
      url.searchParams.set("count", String(JOBICY_RESULT_COUNT));
      const keyword = criteria.roleKeywords?.[0];
      if (keyword) {
        url.searchParams.set("tag", keyword);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetchImpl(url.toString(), { signal: controller.signal });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new JobSourceTimeoutError("Jobicy request timed out");
        }
        throw new JobSourceUnavailableError(`Jobicy is unavailable: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 401 || response.status === 403) {
        throw new JobSourceAuthError(`Jobicy authentication failed (HTTP ${response.status})`);
      }
      if (response.status === 429) {
        throw new JobSourceRateLimitError("Jobicy rate limit exceeded (HTTP 429)");
      }
      if (!response.ok) {
        throw new JobSourceError(`Jobicy returned an unexpected status (HTTP ${response.status})`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new InvalidJobSourceResponseError("Jobicy response was not valid JSON");
      }

      if (!isJobicyApiResponse(body)) {
        throw new InvalidJobSourceResponseError("Jobicy response did not match the expected shape (missing jobs array)");
      }

      return body.jobs;
    },

    async getJob(_jobId: string): Promise<RawProviderJob | null> {
      return null; // Jobicy has no documented single-job lookup endpoint used here.
    },

    normalize(raw: RawProviderJob): unknown | null {
      return normalizeJobicyJob(raw as JobicyRawJob);
    }
  };
}
