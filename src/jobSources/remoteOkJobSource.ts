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

const REMOTEOK_API_URL = "https://remoteok.com/api";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Remote OK adapter (Phase 8.5) — public JSON API, no API key required, HTML
 * never scraped. As with himalayasJobSource.ts, the raw field names below
 * are this codebase's best-effort documented understanding of Remote OK's
 * public feed; verify against a real response before production use — no
 * live call was made to confirm this during implementation.
 */
export interface RemoteOkJobSourceOptions {
  fetchImpl?: typeof fetch;
}

export interface RemoteOkRawJob extends RawProviderJob {
  id?: string | number;
  slug?: string;
  company?: string;
  position?: string; // job title
  tags?: string[];
  location?: string;
  date?: string; // ISO date string
  url?: string; // Remote OK's own job page — the URL Remote OK itself designates as the listing/apply link
  description?: string;
  salary_min?: number;
  salary_max?: number;
}

function isRemoteOkArray(value: unknown): value is RemoteOkRawJob[] {
  return Array.isArray(value);
}

export function normalizeRemoteOkJob(raw: RemoteOkRawJob): unknown | null {
  const title = typeof raw.position === "string" ? raw.position.trim() : "";
  const company = typeof raw.company === "string" ? raw.company.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const id = raw.id ?? raw.slug;
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const location = typeof raw.location === "string" && raw.location.trim().length > 0 ? raw.location.trim() : "Worldwide";
  const datePosted = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.date) ? raw.date.slice(0, 10) : "";
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0) : [];

  // Remote OK's own /api response starts with a non-job legal/notice entry —
  // this guard (missing title/company/url) naturally excludes it, the same
  // way remotiveNormalizer.ts excludes structurally invalid entries.
  if (!title || !company || !url || id === undefined || id === null || description.length < 20 || !datePosted) {
    return null;
  }

  const salary =
    typeof raw.salary_min === "number" && typeof raw.salary_max === "number" && raw.salary_min > 0 && raw.salary_max > 0
      ? Math.round((raw.salary_min + raw.salary_max) / 2)
      : undefined;

  return {
    jobTitle: title,
    company,
    location,
    country: "Worldwide",
    remoteStatus: "REMOTE", // Remote OK is exclusively a remote-jobs board.
    employmentType: "FULL_TIME", // Remote OK's feed doesn't reliably distinguish employment type — never guessed from tags.
    jobDescription: description,
    requirements: [description],
    responsibilities: [description],
    skills: tags.length > 0 ? tags : [title],
    source: "remoteok",
    sourceUrl: url,
    datePosted,
    ...(salary !== undefined ? { salary, currency: "USD" } : {}),
    externalJobId: String(id)
  };
}

export function createRemoteOkJobSource(options: RemoteOkJobSourceOptions = {}): JobSource {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "remoteok",

    async searchJobs(_criteria: SearchCriteria): Promise<RawProviderJob[]> {
      // Remote OK's public feed is a single unfiltered listing, not a
      // per-keyword search endpoint — role-keyword narrowing happens
      // deterministically downstream, the same pattern as remotiveJobSource.ts.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetchImpl(REMOTEOK_API_URL, { signal: controller.signal });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new JobSourceTimeoutError("Remote OK request timed out");
        }
        throw new JobSourceUnavailableError(`Remote OK is unavailable: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 401 || response.status === 403) {
        throw new JobSourceAuthError(`Remote OK authentication failed (HTTP ${response.status})`);
      }
      if (response.status === 429) {
        throw new JobSourceRateLimitError("Remote OK rate limit exceeded (HTTP 429)");
      }
      if (!response.ok) {
        throw new JobSourceError(`Remote OK returned an unexpected status (HTTP ${response.status})`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new InvalidJobSourceResponseError("Remote OK response was not valid JSON");
      }

      if (!isRemoteOkArray(body)) {
        throw new InvalidJobSourceResponseError("Remote OK response did not match the expected shape (not an array)");
      }

      return body;
    },

    async getJob(_jobId: string): Promise<RawProviderJob | null> {
      return null; // Remote OK has no documented single-job lookup endpoint used here.
    },

    normalize(raw: RawProviderJob): unknown | null {
      return normalizeRemoteOkJob(raw as RemoteOkRawJob);
    }
  };
}
