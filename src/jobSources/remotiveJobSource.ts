import type { JobSource, RawProviderJob } from "./jobSource.js";
import type { SearchCriteria } from "../schemas/searchCriteria.js";
import { normalizeRemotiveJob } from "./remotiveNormalizer.js";
import {
  InvalidJobSourceResponseError,
  JobSourceAuthError,
  JobSourceError,
  JobSourceRateLimitError,
  JobSourceTimeoutError,
  JobSourceUnavailableError
} from "../utils/errors.js";

const REMOTIVE_API_URL = "https://remotive.com/api/remote-jobs";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Remotive has no per-job lookup endpoint in its public API — only search.
 * getJob() therefore only checks the current in-memory cache of the most
 * recent search (never triggers a new live call), documented explicitly
 * here rather than silently under-delivering on the JobSource contract.
 */
export interface RemotiveJobSourceOptions {
  /** Minimum time between real network calls. Defaults to env.remotiveMinFetchIntervalHours. */
  minFetchIntervalMs?: number;
  /** Injectable for tests — defaults to the global fetch (Node 18+ built-in, no new dependency). */
  fetchImpl?: typeof fetch;
  /** Remotive category to search within — see docs/AGENTS.md → Job Discovery for why "software-dev" was chosen. */
  category?: string;
}

interface RemotiveApiResponse {
  jobs: RawProviderJob[];
}

function isRemotiveApiResponse(value: unknown): value is RemotiveApiResponse {
  return typeof value === "object" && value !== null && Array.isArray((value as { jobs?: unknown }).jobs);
}

export function createRemotiveJobSource(options: RemotiveJobSourceOptions = {}): JobSource {
  const minFetchIntervalMs = options.minFetchIntervalMs ?? 6 * 60 * 60 * 1000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const category = options.category ?? "software-dev";

  let lastFetchAt: number | null = null;
  let cachedJobs: RawProviderJob[] | null = null;

  async function fetchRemoteJobs(): Promise<RawProviderJob[]> {
    const now = Date.now();
    if (cachedJobs !== null && lastFetchAt !== null && now - lastFetchAt < minFetchIntervalMs) {
      return cachedJobs;
    }

    const url = new URL(REMOTIVE_API_URL);
    url.searchParams.set("category", category);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), { signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new JobSourceTimeoutError("Remotive request timed out");
      }
      throw new JobSourceUnavailableError(`Remotive is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      throw new JobSourceAuthError(`Remotive authentication failed (HTTP ${response.status})`);
    }
    if (response.status === 429) {
      throw new JobSourceRateLimitError("Remotive rate limit exceeded (HTTP 429)");
    }
    if (!response.ok) {
      throw new JobSourceError(`Remotive returned an unexpected status (HTTP ${response.status})`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new InvalidJobSourceResponseError("Remotive response was not valid JSON");
    }

    if (!isRemotiveApiResponse(body)) {
      throw new InvalidJobSourceResponseError("Remotive response did not match the expected shape (missing jobs array)");
    }

    cachedJobs = body.jobs;
    lastFetchAt = now;
    return cachedJobs;
  }

  return {
    name: "remotive",

    async searchJobs(_criteria: SearchCriteria): Promise<RawProviderJob[]> {
      // Deliberately one call, category-filtered, not one call per role
      // keyword — Remotive's own guidance caps daily calls in the single
      // digits. Role-keyword narrowing happens deterministically downstream
      // (src/services/jobDiscoveryService.ts), not via repeated provider calls.
      return fetchRemoteJobs();
    },

    async getJob(jobId: string): Promise<RawProviderJob | null> {
      if (!cachedJobs) {
        return null;
      }
      return cachedJobs.find((job) => String(job.id) === jobId) ?? null;
    },

    normalize(raw: RawProviderJob): unknown | null {
      return normalizeRemotiveJob(raw);
    }
  };
}
