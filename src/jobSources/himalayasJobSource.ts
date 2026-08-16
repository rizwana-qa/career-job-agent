import type { JobSource, RawProviderJob } from "./jobSource.js";
import type { SearchCriteria } from "../schemas/searchCriteria.js";
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

const HIMALAYAS_API_URL = "https://himalayas.app/jobs/api/search";
const REQUEST_TIMEOUT_MS = 10_000;
/** Documented per-request result cap (Phase 8.5 §3) — never request more than this in one call. */
const HIMALAYAS_RESULT_LIMIT = 20;

/**
 * Targeted multi-query search execution (Phase 8.5.7 §2-3, query text fixed
 * by Phase 8.5.12). Himalayas is a keyword-search endpoint (unlike Remote
 * OK's single unfiltered feed — see remoteOkJobSource.ts, deliberately
 * untouched by this phase), so instead of one broad request per discovery
 * run, searchJobs() below issues a small, bounded set of targeted queries:
 * strongest tiers first (Tier 1 -> Tier 2 -> Tier 4 -> Tier 3, matching
 * searchTierClassifier.ts's own priority order).
 *
 * Phase 8.5.7 originally appended a rotating location word (Pakistan/UAE)
 * to the free-text `q` value. Phase 8.5.11's one-time authorized live
 * diagnostic disproved that this narrowed anything: the same postings
 * recurred across differently-location-tagged queries (and undifferentiated
 * ones), and the adapter's own cross-query dedup removed ~21% of raw
 * results as exact repeats — evidence the API's `q` param does not perform
 * location-aware AND-matching the way the concatenation assumed. Phase
 * 8.5.12 removes the location word entirely: queries are role-phrase-only
 * text. Location eligibility is, and always was, enforced downstream by
 * locationEligibilityFilter.ts against the job's actual normalized
 * location/country/remoteStatus metadata — never by the search query text.
 */
export type HimalayasSearchTier = "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4";

export interface HimalayasSearchQuerySpec {
  tier: HimalayasSearchTier;
  roleKeyword: string;
  query: string;
}

/** Configurable cap on how many targeted queries searchJobs() issues per call (Phase 8.5.7 §2's example value). */
export const MAX_SEARCH_QUERIES_PER_SOURCE = 8;

/** How many queries each tier gets out of MAX_SEARCH_QUERIES_PER_SOURCE — Tier 1 highest priority, Tier 3 fallback (Phase 8.5.7 §6), summing to the default cap above. */
const TIER_QUERY_ALLOCATION: Record<HimalayasSearchTier, number> = {
  TIER_1: 3,
  TIER_2: 2,
  TIER_4: 2,
  TIER_3: 1
};

const TIER_QUERY_SOURCES: ReadonlyArray<{ tier: HimalayasSearchTier; concepts: readonly string[] }> = [
  { tier: "TIER_1", concepts: TIER_1_SEARCH_CONCEPTS },
  { tier: "TIER_2", concepts: TIER_2_SEARCH_CONCEPTS },
  { tier: "TIER_4", concepts: TIER_4_SEARCH_CONCEPTS },
  { tier: "TIER_3", concepts: TIER_3_SEARCH_CONCEPTS }
];

/**
 * Builds the bounded, tier-ordered query plan (Phase 8.5.7 §2/§6) — pure and
 * exported so its ordering/count can be asserted directly in tests without
 * mocking fetch. Never reads `criteria.roleKeywords`: unlike Phase 8.5.6's
 * route-level `buildTierPrioritizedRoleKeywords()` (still used by other
 * sources' single-keyword call sites), Himalayas now owns its own query
 * construction end to end, since it alone can act on more than one keyword
 * per discovery run. As of Phase 8.5.12, `query` is always exactly the role
 * phrase — no location word is ever appended (see doc comment above).
 */
export function buildHimalayasSearchQueryPlan(maxQueries: number = MAX_SEARCH_QUERIES_PER_SOURCE): HimalayasSearchQuerySpec[] {
  const plan: HimalayasSearchQuerySpec[] = [];

  for (const { tier, concepts } of TIER_QUERY_SOURCES) {
    const allocation = Math.min(TIER_QUERY_ALLOCATION[tier], concepts.length);
    for (let i = 0; i < allocation && plan.length < maxQueries; i++) {
      const roleKeyword = concepts[i];
      plan.push({ tier, roleKeyword, query: roleKeyword });
    }
    if (plan.length >= maxQueries) {
      break;
    }
  }

  return plan;
}

/** Safe, compact per-query diagnostic (Phase 8.5.7 §9) — source/query/searchTier/jobsReturned only, never job descriptions, secrets, or Claude prompt content. */
function logHimalayasQueryDiagnostic(tier: HimalayasSearchTier, query: string, jobsReturned: number, error?: unknown): void {
  console.log(
    JSON.stringify({
      source: "career-agent",
      stage: "source_search_query",
      sourceName: "himalayas",
      searchTier: tier,
      query,
      jobsReturned,
      ...(error !== undefined ? { error: toSafeErrorMessage(error) } : {})
    })
  );
}

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
  /** Phase 8.5.7 §2 — overrides MAX_SEARCH_QUERIES_PER_SOURCE for this source instance (mainly for tests). */
  maxSearchQueries?: number;
}

export interface HimalayasRawJob extends RawProviderJob {
  id?: string | number;
  guid?: string;
  title?: string;
  companyName?: string;
  locationRestrictions?: string[];
  seniority?: string;
  employmentType?: string; // documented placeholder assumed "full_time" | "part_time" | "contract" | "freelance" | "internship"; real API (confirmed Phase 8.5.19) returns Title Case values like "Full Time" / "Contractor" — see normalizeEmploymentTypeKey()
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

/**
 * Phase 8.5.20 — the real Himalayas API was confirmed (Phase 8.5.19's one
 * authorized live call) to return human-readable, Title-Case values
 * ("Full Time", "Contractor") rather than the snake_case values this
 * adapter originally assumed ("full_time", "contract"). This was the exact
 * cause of every Himalayas job silently normalizing to null before ever
 * reaching filterEligibleJobs() — the employment-type check runs first in
 * normalizeHimalayasJob(), before title/company/description are even
 * inspected. Normalizes whitespace/case into the existing map's snake_case
 * keys, plus the one non-whitespace synonym ("contractor" -> "contract")
 * observed live — never invents a new employment category, and an
 * unrecognized value still resolves to a key with no map entry, so unknown
 * types continue to fail safely (normalizeHimalayasJob returns null) exactly
 * as before.
 */
function normalizeEmploymentTypeKey(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return cleaned === "contractor" ? "contract" : cleaned;
}

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
  const employmentTypeKey = typeof raw.employmentType === "string" ? normalizeEmploymentTypeKey(raw.employmentType) : "";
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

/** One targeted query's request/parse cycle — extracted so searchJobs() below can run it several times per discovery call, each with its own timeout and error classification. */
async function executeHimalayasSearchRequest(url: URL, fetchImpl: typeof fetch): Promise<RawProviderJob[]> {
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
}

export function createHimalayasJobSource(options: HimalayasJobSourceOptions = {}): JobSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxSearchQueries = options.maxSearchQueries ?? MAX_SEARCH_QUERIES_PER_SOURCE;

  return {
    name: "himalayas",

    /**
     * Executes the bounded, tier-ordered query plan (Phase 8.5.7 §2-3),
     * de-duplicating raw results across queries by provider id (the same
     * posting can legitimately surface under more than one query — e.g. a
     * "Staff SDET" listing that also mentions Pakistan explicitly — and
     * counting it twice would inflate jobsFound/jobsDiscovered downstream).
     * A single query's failure never aborts the whole call — it's recorded
     * as a diagnostic and the remaining queries still run (§9/§11) — but if
     * EVERY query in the plan fails, the first captured error is re-thrown
     * as-is (already correctly classified — JobSourceAuthError,
     * JobSourceTimeoutError, etc. — by executeHimalayasSearchRequest above)
     * so per-source error isolation upstream (jobDiscoveryService.ts) still
     * sees an accurate failure reason.
     */
    async searchJobs(_criteria: SearchCriteria): Promise<RawProviderJob[]> {
      const plan = buildHimalayasSearchQueryPlan(maxSearchQueries);
      const seenIds = new Set<string>();
      const collected: RawProviderJob[] = [];
      let firstError: unknown;
      let successCount = 0;

      for (const spec of plan) {
        const url = new URL(HIMALAYAS_API_URL);
        url.searchParams.set("limit", String(HIMALAYAS_RESULT_LIMIT));
        url.searchParams.set("q", spec.query);

        try {
          const jobs = await executeHimalayasSearchRequest(url, fetchImpl);
          successCount += 1;
          logHimalayasQueryDiagnostic(spec.tier, spec.query, jobs.length);
          for (const raw of jobs) {
            const rawJob = raw as HimalayasRawJob;
            const rawId = rawJob.id ?? rawJob.guid;
            const idKey = rawId !== undefined && rawId !== null ? String(rawId) : undefined;
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
          logHimalayasQueryDiagnostic(spec.tier, spec.query, 0, error);
        }
      }

      if (successCount === 0 && firstError !== undefined) {
        throw firstError;
      }
      return collected;
    },

    async getJob(_jobId: string): Promise<RawProviderJob | null> {
      return null; // Himalayas has no documented single-job lookup endpoint used here.
    },

    normalize(raw: RawProviderJob): unknown | null {
      return normalizeHimalayasJob(raw as HimalayasRawJob);
    }
  };
}
