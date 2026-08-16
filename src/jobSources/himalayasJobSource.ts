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

const HIMALAYAS_API_URL = "https://himalayas.app/jobs/api/search";
const REQUEST_TIMEOUT_MS = 10_000;
/** Documented per-request result cap (Phase 8.5 §3) — never request more than this in one call. */
const HIMALAYAS_RESULT_LIMIT = 20;

/**
 * Himalayas adapter (Phase 8.5) — public JSON API, no API key required. The
 * exact response field names below are this codebase's best-effort,
 * documented understanding of Himalayas's public search endpoint; they have
 * NOT been exercised against a real response (no live job-source calls were
 * authorized during implementation — see docs/JOB_SOURCES.md). Verify/adjust
 * `HimalayasRawJob`/`normalizeHimalayasJob()` against a real response before
 * relying on this in production, the same way Phase 6.1 required one
 * authorized live Claude call before trusting that integration.
 */
export interface HimalayasJobSourceOptions {
  fetchImpl?: typeof fetch;
}

export interface HimalayasRawJob extends RawProviderJob {
  id?: string | number;
  guid?: string;
  title?: string;
  companyName?: string;
  locationRestrictions?: string[];
  seniority?: string;
  employmentType?: string; // "full_time" | "part_time" | "contract" | "freelance" | "internship"
  minSalary?: number;
  maxSalary?: number;
  salaryCurrency?: string;
  pubDate?: string; // ISO date string or unix seconds — normalized defensively
  applicationLink?: string; // the original, direct apply URL — preferred sourceUrl
  description?: string;
}

interface HimalayasApiResponse {
  jobs: RawProviderJob[];
}

function isHimalayasApiResponse(value: unknown): value is HimalayasApiResponse {
  return typeof value === "object" && value !== null && Array.isArray((value as { jobs?: unknown }).jobs);
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACT",
  freelance: "FREELANCE",
  internship: "INTERNSHIP"
};

function toDatePosted(pubDate: unknown): string {
  if (typeof pubDate === "number") {
    const ms = pubDate > 1e12 ? pubDate : pubDate * 1000; // seconds vs ms
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
  }
  if (typeof pubDate === "string") {
    const d = new Date(pubDate);
    if (Number.isFinite(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  return "";
}

/**
 * Never fabricates an application URL (Phase 8.5 §4/§9) — a job with no
 * `applicationLink` normalizes to null (dropped) rather than being pointed
 * at a guessed/reconstructed Himalayas page URL.
 */
export function normalizeHimalayasJob(raw: HimalayasRawJob): unknown | null {
  const employmentTypeKey = typeof raw.employmentType === "string" ? raw.employmentType.trim().toLowerCase() : "";
  const employmentType = EMPLOYMENT_TYPE_MAP[employmentTypeKey];
  if (!employmentType) {
    return null;
  }

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const company = typeof raw.companyName === "string" ? raw.companyName.trim() : "";
  const url = typeof raw.applicationLink === "string" ? raw.applicationLink.trim() : "";
  const id = raw.id ?? raw.guid;
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const locations = Array.isArray(raw.locationRestrictions)
    ? raw.locationRestrictions.filter((l): l is string => typeof l === "string" && l.trim().length > 0)
    : [];
  const datePosted = toDatePosted(raw.pubDate);

  if (!title || !company || !url || id === undefined || id === null || description.length < 20 || !datePosted) {
    return null;
  }

  const locationText = locations.length > 0 ? locations.join(", ") : "Worldwide";
  const country = locations.length > 0 ? locations[0] : "Worldwide";
  const salary =
    typeof raw.minSalary === "number" && typeof raw.maxSalary === "number" ? Math.round((raw.minSalary + raw.maxSalary) / 2) : undefined;
  const currency = salary !== undefined && typeof raw.salaryCurrency === "string" ? raw.salaryCurrency : undefined;

  return {
    jobTitle: title,
    company,
    location: locationText,
    country,
    remoteStatus: "REMOTE", // Himalayas is exclusively a remote-jobs board.
    employmentType,
    jobDescription: description,
    requirements: [description],
    responsibilities: [description],
    skills: [title],
    source: "himalayas",
    sourceUrl: url,
    datePosted,
    ...(salary !== undefined && currency ? { salary, currency } : {}),
    externalJobId: String(id)
  };
}

export function createHimalayasJobSource(options: HimalayasJobSourceOptions = {}): JobSource {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "himalayas",

    async searchJobs(criteria: SearchCriteria): Promise<RawProviderJob[]> {
      const url = new URL(HIMALAYAS_API_URL);
      url.searchParams.set("limit", String(HIMALAYAS_RESULT_LIMIT));
      const keyword = criteria.roleKeywords?.[0];
      if (keyword) {
        url.searchParams.set("q", keyword);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetchImpl(url.toString(), { signal: controller.signal });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new JobSourceTimeoutError("Himalayas request timed out");
        }
        throw new JobSourceUnavailableError(`Himalayas is unavailable: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 401 || response.status === 403) {
        throw new JobSourceAuthError(`Himalayas authentication failed (HTTP ${response.status})`);
      }
      if (response.status === 429) {
        throw new JobSourceRateLimitError("Himalayas rate limit exceeded (HTTP 429)");
      }
      if (!response.ok) {
        throw new JobSourceError(`Himalayas returned an unexpected status (HTTP ${response.status})`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new InvalidJobSourceResponseError("Himalayas response was not valid JSON");
      }

      if (!isHimalayasApiResponse(body)) {
        throw new InvalidJobSourceResponseError("Himalayas response did not match the expected shape (missing jobs array)");
      }

      return body.jobs;
    },

    async getJob(_jobId: string): Promise<RawProviderJob | null> {
      return null; // Himalayas has no documented single-job lookup endpoint used here.
    },

    normalize(raw: RawProviderJob): unknown | null {
      return normalizeHimalayasJob(raw as HimalayasRawJob);
    }
  };
}
