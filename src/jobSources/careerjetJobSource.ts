import type { JobSource, RawProviderJob } from "./jobSource.js";
import type { SearchCriteria } from "../schemas/searchCriteria.js";
import { env } from "../config/env.js";
import { TIER_1_SEARCH_CONCEPTS, TIER_2_SEARCH_CONCEPTS, TIER_3_SEARCH_CONCEPTS, TIER_4_SEARCH_CONCEPTS } from "./searchConcepts.js";
import {
  InvalidJobSourceResponseError,
  JobSourceAuthError,
  JobSourceError,
  JobSourceRateLimitError,
  JobSourceTimeoutError,
  JobSourceUnavailableError,
  toSafeErrorMessage
} from "../utils/errors.js";

/**
 * Careerjet adapter (Phase 8.5.15) — official Careerjet partner/affiliate
 * Job Search API. Requires an approved affiliate account: CAREERJET_API_KEY
 * + CAREERJET_AFFILIATE_ID (env.ts), neither configured in this environment
 * — `searchJobs()` throws JobSourceAuthError until they are. Never scrapes
 * Careerjet HTML, never automates login, never invents an undocumented
 * endpoint or parameter.
 *
 * Like himalayasJobSource.ts, this issues a small, bounded, tier-prioritized
 * set of targeted queries (never a Cartesian product of every role phrase
 * times every location) — but UNLIKE Himalayas (which has no separate
 * location parameter, and where Phase 8.5.12's live diagnostic showed
 * appending a location word to free text doesn't narrow anything), Careerjet
 * documents a genuine separate `location`/`locale_code` parameter pair, so
 * this adapter uses those structured params directly instead of embedding
 * location into the keyword string (Phase 8.5.15 §6's explicit instruction).
 *
 * The exact response field names in `CareerjetRawJob` are this codebase's
 * best-effort, documented understanding of Careerjet's public affiliate
 * feed — consistent with the same caveat already applied to Himalayas/
 * Remote OK/Jobicy/WWR in docs/JOB_SOURCES.md: NOT yet exercised against a
 * real response (no live Careerjet call was made or authorized while
 * implementing this). Verify/adjust before trusting this in production, the
 * same way Phase 6.1 required one authorized live Claude call first.
 */
export interface CareerjetJobSourceOptions {
  fetchImpl?: typeof fetch;
  /** Phase 8.5.15 §8 — overrides MAX_SEARCH_QUERIES_PER_SOURCE for this source instance (mainly for tests). */
  maxSearchQueries?: number;
  /** Phase 8.5.15 §5 — overrides DEFAULT_CAREERJET_TARGET_LOCALES for this source instance. */
  targetLocales?: CareerjetTargetLocale[];
}

export interface CareerjetRawJob extends RawProviderJob {
  jobId?: string;
  title?: string;
  company?: string;
  locations?: string;
  description?: string;
  date?: string; // ISO date string, or a full "YYYY-MM-DD HH:MM:SS" timestamp
  url?: string; // Careerjet's own affiliate-tracked listing URL
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrencyCode?: string;
  salary?: string; // free-text fallback, e.g. "AED 15,000 - 20,000" — used only when the numeric fields above are absent
}

interface CareerjetApiResponse {
  jobs: RawProviderJob[];
}

function isCareerjetApiResponse(value: unknown): value is CareerjetApiResponse {
  return typeof value === "object" && value !== null && Array.isArray((value as { jobs?: unknown }).jobs);
}

const REMOTE_LOCATION_TEXT_PATTERNS: RegExp[] = [/\bremote\b/i, /\banywhere\b/i, /\bwork\s*from\s*home\b/i];
const HYBRID_LOCATION_TEXT_PATTERNS: RegExp[] = [/\bhybrid\b/i];

/** Careerjet's `locations` text is the only remote-mode signal this feed exposes — a job explicitly labeled Remote/Hybrid is trusted; everything else defaults to ONSITE (Careerjet's Pakistan/UAE country sites are overwhelmingly onsite/hybrid listings, never assumed remote). */
function detectRemoteStatus(locationText: string): "REMOTE" | "HYBRID" | "ONSITE" {
  if (REMOTE_LOCATION_TEXT_PATTERNS.some((pattern) => pattern.test(locationText))) {
    return "REMOTE";
  }
  if (HYBRID_LOCATION_TEXT_PATTERNS.some((pattern) => pattern.test(locationText))) {
    return "HYBRID";
  }
  return "ONSITE";
}

/**
 * Never fabricates an application URL or a salary figure (CLAUDE.md rule 5)
 * — a job with no `url` normalizes to null (dropped); salary is only set
 * when Careerjet's own numeric salary fields are present, never parsed by
 * guesswork from the free-text fallback.
 */
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

  const salary =
    typeof raw.salaryMin === "number" && typeof raw.salaryMax === "number"
      ? Math.round((raw.salaryMin + raw.salaryMax) / 2)
      : undefined;
  const currency = salary !== undefined && typeof raw.salaryCurrencyCode === "string" ? raw.salaryCurrencyCode : undefined;

  return {
    jobTitle: title,
    company,
    location,
    country,
    remoteStatus: detectRemoteStatus(location),
    employmentType: "FULL_TIME", // Careerjet's documented feed doesn't reliably distinguish employment type in this best-effort shape.
    jobDescription: description,
    requirements: [description],
    responsibilities: [description],
    skills: [title],
    source: "careerjet",
    sourceUrl: url,
    datePosted,
    discoveredAt: new Date().toISOString().slice(0, 10),
    ...(salary !== undefined && currency ? { salary, currency } : {}),
    externalJobId: jobId
  };
}

// ---------------------------------------------------------------------------
// Targeted multi-query search execution (Phase 8.5.15 §7-8) — mirrors
// himalayasJobSource.ts's design: bounded, tier-prioritized query plan,
// TIER_1 -> TIER_2 -> TIER_4 -> TIER_3, same allocation split, same
// MAX_SEARCH_QUERIES_PER_SOURCE default. The one structural difference is
// that each query also carries a genuine, separate location/locale pair
// (Careerjet's documented `location`/`locale_code` params), rather than
// folding location into the keyword text.
// ---------------------------------------------------------------------------

export type CareerjetSearchTier = "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4";

/** Phase 8.5.15 §5 — target locales, deliberately declared as data (not hardcoded inline in the query-building logic) so they're overridable via CareerjetJobSourceOptions.targetLocales. */
export interface CareerjetTargetLocale {
  /** Careerjet's documented country-site locale code. */
  localeCode: string;
  /** The location value passed alongside it — a city or country name Careerjet's location parameter accepts. */
  location: string;
}

/** Pakistan (Islamabad + country-wide) and UAE (Dubai, Abu Dhabi, country-wide) — Phase 8.5.15 §5/§6/§8's exact target list. */
export const DEFAULT_CAREERJET_TARGET_LOCALES: readonly CareerjetTargetLocale[] = [
  { localeCode: "en_PK", location: "Islamabad" },
  { localeCode: "en_PK", location: "Pakistan" },
  { localeCode: "en_AE", location: "Dubai" },
  { localeCode: "en_AE", location: "Abu Dhabi" },
  { localeCode: "en_AE", location: "UAE" }
];

export interface CareerjetSearchQuerySpec {
  tier: CareerjetSearchTier;
  roleKeyword: string;
  localeCode: string;
  location: string;
}

/** Configurable cap on how many targeted queries searchJobs() issues per call (Phase 8.5.15 §8's example value). */
export const MAX_SEARCH_QUERIES_PER_SOURCE = 8;

/** Same tier-priority allocation as himalayasJobSource.ts — Tier 1 highest priority, Tier 3 fallback, summing to the default cap above. */
const TIER_QUERY_ALLOCATION: Record<CareerjetSearchTier, number> = {
  TIER_1: 3,
  TIER_2: 2,
  TIER_4: 2,
  TIER_3: 1
};

const TIER_QUERY_SOURCES: ReadonlyArray<{ tier: CareerjetSearchTier; concepts: readonly string[] }> = [
  { tier: "TIER_1", concepts: TIER_1_SEARCH_CONCEPTS },
  { tier: "TIER_2", concepts: TIER_2_SEARCH_CONCEPTS },
  { tier: "TIER_4", concepts: TIER_4_SEARCH_CONCEPTS },
  { tier: "TIER_3", concepts: TIER_3_SEARCH_CONCEPTS }
];

/**
 * Builds the bounded, tier-ordered query plan, pairing each selected role
 * phrase with one target locale from a rotating (not fully-crossed) list —
 * a controlled matrix (Phase 8.5.15 §8), never every role times every
 * location. Pure and exported so its ordering/count/location pairing can be
 * asserted directly in tests without mocking fetch.
 */
export function buildCareerjetSearchQueryPlan(
  maxQueries: number = MAX_SEARCH_QUERIES_PER_SOURCE,
  targetLocales: readonly CareerjetTargetLocale[] = DEFAULT_CAREERJET_TARGET_LOCALES
): CareerjetSearchQuerySpec[] {
  const plan: CareerjetSearchQuerySpec[] = [];
  let locationCursor = 0;

  for (const { tier, concepts } of TIER_QUERY_SOURCES) {
    const allocation = Math.min(TIER_QUERY_ALLOCATION[tier], concepts.length);
    for (let i = 0; i < allocation && plan.length < maxQueries; i++) {
      const roleKeyword = concepts[i];
      const targetLocale = targetLocales[locationCursor % targetLocales.length];
      locationCursor++;
      plan.push({ tier, roleKeyword, localeCode: targetLocale.localeCode, location: targetLocale.location });
    }
    if (plan.length >= maxQueries) {
      break;
    }
  }

  return plan;
}

/** Safe, compact per-query diagnostic (mirrors himalayasJobSource.ts's) — source/query/searchTier/location/jobsReturned only, never job descriptions, credentials, or Claude prompt content. */
function logCareerjetQueryDiagnostic(spec: CareerjetSearchQuerySpec, jobsReturned: number, error?: unknown): void {
  console.log(
    JSON.stringify({
      source: "career-agent",
      stage: "source_search_query",
      sourceName: "careerjet",
      searchTier: spec.tier,
      query: spec.roleKeyword,
      location: spec.location,
      localeCode: spec.localeCode,
      jobsReturned,
      ...(error !== undefined ? { error: toSafeErrorMessage(error) } : {})
    })
  );
}

const CAREERJET_API_URL = "http://public-api.careerjet.net/search";
const REQUEST_TIMEOUT_MS = 10_000;
/** Best-effort per-request result cap — unverified against the real API, mirrors the conservative cap already used for Himalayas/Remote OK. */
const CAREERJET_RESULT_LIMIT = 20;
/** Careerjet's affiliate terms document `url` as the page where results will be shown, for attribution — this app has no public results page, so this points at the API endpoint that ultimately surfaces the shortlist. */
const CAREERJET_ATTRIBUTION_URL = "https://ai-job-assistant-gules-eight.vercel.app/career/discover-match";
const CAREERJET_USER_AGENT = "career-job-agent/1.0 (+https://ai-job-assistant-gules-eight.vercel.app)";

/** One targeted query's request/parse cycle — extracted so searchJobs() below can run it several times per discovery call, each with its own timeout and error classification. */
async function executeCareerjetSearchRequest(url: URL, fetchImpl: typeof fetch): Promise<RawProviderJob[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new JobSourceTimeoutError("Careerjet request timed out");
    }
    throw new JobSourceUnavailableError(`Careerjet is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    throw new JobSourceAuthError(`Careerjet authentication failed (HTTP ${response.status})`);
  }
  if (response.status === 429) {
    throw new JobSourceRateLimitError("Careerjet rate limit exceeded (HTTP 429)");
  }
  if (!response.ok) {
    throw new JobSourceError(`Careerjet returned an unexpected status (HTTP ${response.status})`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new InvalidJobSourceResponseError("Careerjet response was not valid JSON");
  }

  if (!isCareerjetApiResponse(body)) {
    throw new InvalidJobSourceResponseError("Careerjet response did not match the expected shape (missing jobs array)");
  }

  return body.jobs;
}

export function createCareerjetJobSource(options: CareerjetJobSourceOptions = {}): JobSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxSearchQueries = options.maxSearchQueries ?? MAX_SEARCH_QUERIES_PER_SOURCE;
  const targetLocales = options.targetLocales ?? DEFAULT_CAREERJET_TARGET_LOCALES;

  return {
    name: "careerjet",

    /**
     * Executes the bounded, tier-ordered, locale-paired query plan. A
     * single query's failure never aborts the whole call — recorded as a
     * diagnostic, remaining queries still run — but if EVERY query fails,
     * the first captured (already correctly classified) error is re-thrown
     * so per-source error isolation upstream (jobDiscoveryService.ts) still
     * reports an accurate failure reason, e.g. {name:"careerjet",
     * status:"FAILED"} without ever exposing the raw error or credentials.
     */
    async searchJobs(_criteria: SearchCriteria): Promise<RawProviderJob[]> {
      if (!env.careerjetApiKey || !env.careerjetAffiliateId) {
        throw new JobSourceAuthError(
          "Careerjet integration requires CAREERJET_API_KEY and CAREERJET_AFFILIATE_ID, which are not configured (see docs/JOB_SOURCES.md)."
        );
      }

      const plan = buildCareerjetSearchQueryPlan(maxSearchQueries, targetLocales);
      const seenIds = new Set<string>();
      const collected: RawProviderJob[] = [];
      let firstError: unknown;
      let successCount = 0;

      for (const spec of plan) {
        const url = new URL(CAREERJET_API_URL);
        url.searchParams.set("keywords", spec.roleKeyword);
        url.searchParams.set("location", spec.location);
        url.searchParams.set("locale_code", spec.localeCode);
        url.searchParams.set("affid", env.careerjetAffiliateId);
        // Unverified transport for the API key — Careerjet's documented
        // public affiliate search endpoint historically authenticates via
        // `affid` alone; this app's env config additionally requires
        // CAREERJET_API_KEY (established before this phase), so it's sent
        // as a best-effort query param until the real partner API contract
        // confirms the correct mechanism (see docs/JOB_SOURCES.md caveat).
        url.searchParams.set("api_key", env.careerjetApiKey);
        url.searchParams.set("sort", "date"); // Phase 8.5.15 §9 — prefer freshness, unverified against the live contract
        url.searchParams.set("pagesize", String(CAREERJET_RESULT_LIMIT));
        url.searchParams.set("user_ip", "0.0.0.0");
        url.searchParams.set("user_agent", CAREERJET_USER_AGENT);
        url.searchParams.set("url", CAREERJET_ATTRIBUTION_URL);

        try {
          const jobs = await executeCareerjetSearchRequest(url, fetchImpl);
          successCount += 1;
          logCareerjetQueryDiagnostic(spec, jobs.length);
          for (const raw of jobs) {
            const rawJob = raw as CareerjetRawJob;
            const idKey = typeof rawJob.jobId === "string" && rawJob.jobId.trim().length > 0 ? rawJob.jobId.trim() : undefined;
            if (idKey) {
              if (seenIds.has(idKey)) {
                continue;
              }
              seenIds.add(idKey);
            }
            collected.push(raw);
          }
        } catch (error) {
          if (firstError === undefined) {
            firstError = error;
          }
          logCareerjetQueryDiagnostic(spec, 0, error);
        }
      }

      if (successCount === 0 && firstError !== undefined) {
        throw firstError;
      }
      return collected;
    },

    async getJob(_jobId: string): Promise<RawProviderJob | null> {
      return null; // Careerjet has no documented single-job lookup endpoint used here.
    },

    normalize(raw: RawProviderJob): unknown | null {
      return normalizeCareerjetJob(raw as CareerjetRawJob);
    }
  };
}
