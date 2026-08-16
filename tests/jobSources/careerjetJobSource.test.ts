import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildCareerjetSearchQueryPlan,
  createCareerjetJobSource,
  normalizeCareerjetJob,
  MAX_SEARCH_QUERIES_PER_SOURCE,
  DEFAULT_CAREERJET_TARGET_LOCALES,
  type CareerjetRawJob
} from "../../src/jobSources/careerjetJobSource.js";
import { env } from "../../src/config/env.js";
import {
  InvalidJobSourceResponseError,
  JobSourceAuthError,
  JobSourceError,
  JobSourceRateLimitError,
  JobSourceTimeoutError,
  JobSourceUnavailableError
} from "../../src/utils/errors.js";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function rawCareerjetJob(overrides: Partial<CareerjetRawJob> = {}): CareerjetRawJob {
  return {
    jobId: "cj-3301",
    title: "QA Test Lead",
    company: "Falcon Emirates",
    locations: "Dubai, United Arab Emirates",
    description: "Lead a team of QA engineers delivering automated test coverage for our fintech platform.",
    date: "2026-08-10",
    url: "https://www.careerjet.ae/jobad/cj-3301",
    ...overrides
  };
}

describe("normalizeCareerjetJob", () => {
  it("normalizes a well-formed raw Careerjet job into the common Job shape", () => {
    const normalized = normalizeCareerjetJob(rawCareerjetJob()) as Record<string, unknown>;
    expect(normalized).toMatchObject({
      jobTitle: "QA Test Lead",
      company: "Falcon Emirates",
      location: "Dubai, United Arab Emirates",
      country: "United Arab Emirates",
      remoteStatus: "ONSITE",
      employmentType: "FULL_TIME",
      source: "careerjet",
      sourceUrl: "https://www.careerjet.ae/jobad/cj-3301",
      datePosted: "2026-08-10",
      externalJobId: "cj-3301"
    });
    expect(typeof (normalized as { discoveredAt: string }).discoveredAt).toBe("string");
  });

  it("detects a Remote-labeled listing as remoteStatus REMOTE", () => {
    const normalized = normalizeCareerjetJob(rawCareerjetJob({ locations: "Remote - Pakistan" })) as Record<string, unknown>;
    expect(normalized.remoteStatus).toBe("REMOTE");
  });

  it("detects a Hybrid-labeled listing as remoteStatus HYBRID", () => {
    const normalized = normalizeCareerjetJob(rawCareerjetJob({ locations: "Hybrid - Islamabad, Pakistan" })) as Record<string, unknown>;
    expect(normalized.remoteStatus).toBe("HYBRID");
  });

  it("computes salary as the midpoint only when both numeric fields and currency are present — never invented from free text", () => {
    const normalized = normalizeCareerjetJob(
      rawCareerjetJob({ salaryMin: 15000, salaryMax: 20000, salaryCurrencyCode: "AED" })
    ) as Record<string, unknown>;
    expect(normalized.salary).toBe(17500);
    expect(normalized.currency).toBe("AED");
  });

  it("leaves salary/currency undefined when Careerjet's numeric salary fields are absent, even if free-text salary exists", () => {
    const normalized = normalizeCareerjetJob(rawCareerjetJob({ salary: "AED 15,000 - 20,000" })) as Record<string, unknown>;
    expect(normalized.salary).toBeUndefined();
    expect(normalized.currency).toBeUndefined();
  });

  it("returns null when required fields are missing — never fabricates a URL", () => {
    expect(normalizeCareerjetJob(rawCareerjetJob({ title: undefined }))).toBeNull();
    expect(normalizeCareerjetJob(rawCareerjetJob({ url: undefined }))).toBeNull();
    expect(normalizeCareerjetJob(rawCareerjetJob({ description: "too short" }))).toBeNull();
    expect(normalizeCareerjetJob(rawCareerjetJob({ jobId: undefined }))).toBeNull();
  });
});

describe("buildCareerjetSearchQueryPlan (Phase 8.5.15 §7/§8)", () => {
  it("never exceeds MAX_SEARCH_QUERIES_PER_SOURCE by default", () => {
    const plan = buildCareerjetSearchQueryPlan();
    expect(plan.length).toBeLessThanOrEqual(MAX_SEARCH_QUERIES_PER_SOURCE);
    expect(plan.length).toBe(8);
  });

  it("orders queries Tier 1 -> Tier 2 -> Tier 4 -> Tier 3, matching the search priority order", () => {
    const plan = buildCareerjetSearchQueryPlan();
    expect(plan.map((spec) => spec.tier)).toEqual(["TIER_1", "TIER_1", "TIER_1", "TIER_2", "TIER_2", "TIER_4", "TIER_4", "TIER_3"]);
  });

  it("respects tier allocation TIER_1=3, TIER_2=2, TIER_4=2, TIER_3=1", () => {
    const plan = buildCareerjetSearchQueryPlan();
    const counts = plan.reduce<Record<string, number>>((acc, spec) => {
      acc[spec.tier] = (acc[spec.tier] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ TIER_1: 3, TIER_2: 2, TIER_4: 2, TIER_3: 1 });
  });

  it("respects a smaller caller-supplied cap without exceeding it", () => {
    const plan = buildCareerjetSearchQueryPlan(3);
    expect(plan).toHaveLength(3);
    expect(plan.every((spec) => spec.tier === "TIER_1")).toBe(true);
  });

  it("pairs each query with a location/locale from the target-locale list, never leaving them unset", () => {
    const plan = buildCareerjetSearchQueryPlan();
    for (const spec of plan) {
      expect(DEFAULT_CAREERJET_TARGET_LOCALES.some((tl) => tl.location === spec.location && tl.localeCode === spec.localeCode)).toBe(
        true
      );
    }
  });

  it("supports overriding the target-locale list — it's configurable, not hardcoded inside the query logic", () => {
    const customLocales = [{ localeCode: "en_SA", location: "Riyadh" }];
    const plan = buildCareerjetSearchQueryPlan(2, customLocales);
    expect(plan.every((spec) => spec.localeCode === "en_SA" && spec.location === "Riyadh")).toBe(true);
  });

  it("uses Pakistan (en_PK) and UAE (en_AE) locale codes from the default target-locale list", () => {
    const localeCodesUsed = new Set(DEFAULT_CAREERJET_TARGET_LOCALES.map((tl) => tl.localeCode));
    expect(localeCodesUsed).toEqual(new Set(["en_PK", "en_AE"]));
  });
});

describe("createCareerjetJobSource — searchJobs (credential gate)", () => {
  const originalKey = env.careerjetApiKey;
  const originalAffiliate = env.careerjetAffiliateId;

  afterEach(() => {
    env.careerjetApiKey = originalKey;
    env.careerjetAffiliateId = originalAffiliate;
  });

  it("throws JobSourceAuthError when no credentials are configured — never attempts a request", async () => {
    env.careerjetApiKey = undefined;
    env.careerjetAffiliateId = undefined;
    const fetchImpl = vi.fn();
    const source = createCareerjetJobSource({ fetchImpl });
    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceAuthError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws JobSourceAuthError when only one of the two credentials is set", async () => {
    env.careerjetApiKey = "test-key";
    env.careerjetAffiliateId = undefined;
    const fetchImpl = vi.fn();
    const source = createCareerjetJobSource({ fetchImpl });
    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceAuthError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/** Every test below sets fake credentials and ALWAYS supplies a mocked fetchImpl — never the real global fetch — so no live Careerjet call is ever possible here. */
describe("createCareerjetJobSource — multi-query execution (credentials present, fetch mocked)", () => {
  const originalKey = env.careerjetApiKey;
  const originalAffiliate = env.careerjetAffiliateId;

  beforeEach(() => {
    env.careerjetApiKey = "test-key";
    env.careerjetAffiliateId = "test-affiliate";
  });

  afterEach(() => {
    env.careerjetApiKey = originalKey;
    env.careerjetAffiliateId = originalAffiliate;
  });

  it("issues at most MAX_SEARCH_QUERIES_PER_SOURCE fetch calls, all against the documented endpoint with affid/keywords/location/locale_code set", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [] }));
    const source = createCareerjetJobSource({ fetchImpl });

    await source.searchJobs({});

    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(MAX_SEARCH_QUERIES_PER_SOURCE);
    expect(fetchImpl.mock.calls.length).toBe(8);
    for (const call of fetchImpl.mock.calls) {
      const calledUrl = (call[0] as string).toString();
      expect(calledUrl).toContain("public-api.careerjet.net/search");
      expect(calledUrl).toContain("affid=test-affiliate");
      expect(calledUrl).toContain("keywords=");
      expect(calledUrl).toContain("location=");
      expect(calledUrl).toContain("locale_code=");
    }
  });

  it("never sends CAREERJET_API_KEY/CAREERJET_AFFILIATE_ID anywhere but the documented endpoint's own query string", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [] }));
    const source = createCareerjetJobSource({ fetchImpl });
    await source.searchJobs({});
    for (const call of fetchImpl.mock.calls) {
      expect((call[0] as string).toString().startsWith("http://public-api.careerjet.net/search")).toBe(true);
    }
  });

  it("de-duplicates the same raw job id returned by more than one targeted query", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [rawCareerjetJob({ jobId: "cj-7001" })] }));
    const source = createCareerjetJobSource({ fetchImpl, maxSearchQueries: 4 });

    const jobs = await source.searchJobs({});
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(jobs).toHaveLength(1); // same jobId across all 4 queries collapses to one entry
  });

  it("isolates a single failing query — other queries' results still come back", async () => {
    let callIndex = 0;
    const fetchImpl = vi.fn(async () => {
      callIndex += 1;
      if (callIndex === 1) {
        throw new TypeError("fetch failed");
      }
      return jsonResponse({ jobs: [rawCareerjetJob({ jobId: `ok-${callIndex}` })] });
    });
    const source = createCareerjetJobSource({ fetchImpl, maxSearchQueries: 3 });

    const jobs = await source.searchJobs({});
    expect(jobs).toHaveLength(2); // queries 2 and 3 succeeded; query 1's failure was isolated
  });

  it("re-throws the first captured error, correctly classified, only when every query fails", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 403));
    const source = createCareerjetJobSource({ fetchImpl, maxSearchQueries: 2 });
    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceAuthError);
  });

  it("throws JobSourceTimeoutError when every query aborts", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    await expect(createCareerjetJobSource({ fetchImpl, maxSearchQueries: 1 }).searchJobs({})).rejects.toBeInstanceOf(
      JobSourceTimeoutError
    );
  });

  it("throws JobSourceUnavailableError on a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(createCareerjetJobSource({ fetchImpl, maxSearchQueries: 1 }).searchJobs({})).rejects.toBeInstanceOf(
      JobSourceUnavailableError
    );
  });

  it("throws JobSourceRateLimitError on HTTP 429", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429));
    await expect(createCareerjetJobSource({ fetchImpl, maxSearchQueries: 1 }).searchJobs({})).rejects.toBeInstanceOf(
      JobSourceRateLimitError
    );
  });

  it("throws a generic JobSourceError on an unexpected non-OK status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    await expect(createCareerjetJobSource({ fetchImpl, maxSearchQueries: 1 }).searchJobs({})).rejects.toBeInstanceOf(JobSourceError);
  });

  it("throws InvalidJobSourceResponseError when the JSON shape is unexpected", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ notJobs: [] }));
    await expect(createCareerjetJobSource({ fetchImpl, maxSearchQueries: 1 }).searchJobs({})).rejects.toBeInstanceOf(
      InvalidJobSourceResponseError
    );
  });

  it("returns real jobs from a successful mocked response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [rawCareerjetJob()] }));
    const jobs = await createCareerjetJobSource({ fetchImpl, maxSearchQueries: 1 }).searchJobs({});
    expect(jobs).toHaveLength(1);
  });
});

describe("createCareerjetJobSource.normalize / getJob", () => {
  it("normalize() delegates to normalizeCareerjetJob", () => {
    const source = createCareerjetJobSource();
    expect((source.normalize(rawCareerjetJob()) as Record<string, unknown>).source).toBe("careerjet");
  });

  it("getJob always returns null (no live lookup implemented)", async () => {
    await expect(createCareerjetJobSource().getJob("cj-3301")).resolves.toBeNull();
  });
});
