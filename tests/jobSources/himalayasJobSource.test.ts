import { describe, expect, it, vi } from "vitest";
import {
  buildHimalayasSearchQueryPlan,
  createHimalayasJobSource,
  normalizeHimalayasJob,
  MAX_SEARCH_QUERIES_PER_SOURCE,
  type HimalayasRawJob
} from "../../src/jobSources/himalayasJobSource.js";
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

function rawHimalayasJob(overrides: Partial<HimalayasRawJob> = {}): HimalayasRawJob {
  return {
    id: 5001,
    title: "Senior QA Engineer",
    companyName: "Nimbus Labs",
    locationRestrictions: ["Worldwide"],
    employmentType: "full_time",
    minSalary: 60000,
    maxSalary: 80000,
    salaryCurrency: "USD",
    pubDate: "2026-08-10T00:00:00Z",
    applicationLink: "https://himalayas.app/companies/nimbus-labs/jobs/senior-qa-engineer",
    description: "Own quality engineering strategy across a growing SaaS platform, including automation and API testing.",
    ...overrides
  };
}

describe("normalizeHimalayasJob", () => {
  it("normalizes a well-formed raw Himalayas job into the common Job shape", () => {
    const normalized = normalizeHimalayasJob(rawHimalayasJob()) as Record<string, unknown>;
    expect(normalized).toMatchObject({
      jobTitle: "Senior QA Engineer",
      company: "Nimbus Labs",
      remoteStatus: "REMOTE",
      employmentType: "FULL_TIME",
      source: "himalayas",
      sourceUrl: "https://himalayas.app/companies/nimbus-labs/jobs/senior-qa-engineer",
      datePosted: "2026-08-10",
      externalJobId: "5001",
      salary: 70000,
      currency: "USD"
    });
  });

  it("returns null when applicationLink is missing — never fabricates a URL", () => {
    expect(normalizeHimalayasJob(rawHimalayasJob({ applicationLink: undefined }))).toBeNull();
  });

  it("returns null for an unrecognized employment type", () => {
    expect(normalizeHimalayasJob(rawHimalayasJob({ employmentType: "gig" }))).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(normalizeHimalayasJob(rawHimalayasJob({ title: undefined }))).toBeNull();
    expect(normalizeHimalayasJob(rawHimalayasJob({ description: "too short" }))).toBeNull();
  });
});

describe("createHimalayasJobSource — searchJobs", () => {
  it("requests the documented endpoint with the result-count limit applied", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [rawHimalayasJob()] }));
    const source = createHimalayasJobSource({ fetchImpl });

    const jobs = await source.searchJobs({ roleKeywords: ["QA Engineer"] });
    expect(jobs).toHaveLength(1);
    const calledUrl = (fetchImpl.mock.calls[0][0] as string).toString();
    expect(calledUrl).toContain("himalayas.app/jobs/api/search");
    expect(calledUrl).toContain("limit=20");
  });

  it("throws JobSourceTimeoutError when the request aborts", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    await expect(createHimalayasJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceTimeoutError);
  });

  it("throws JobSourceUnavailableError on a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(createHimalayasJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceUnavailableError);
  });

  it("throws JobSourceAuthError on HTTP 401/403", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 403));
    await expect(createHimalayasJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceAuthError);
  });

  it("throws JobSourceRateLimitError on HTTP 429", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429));
    await expect(createHimalayasJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceRateLimitError);
  });

  it("throws a generic JobSourceError on an unexpected non-OK status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    await expect(createHimalayasJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceError);
  });

  it("throws InvalidJobSourceResponseError when the JSON shape is unexpected", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ notJobs: [] }));
    await expect(createHimalayasJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(InvalidJobSourceResponseError);
  });
});

/** Phase 8.5.7 §2/§12 CASE D — verifies no excessive query count, tier ordering, and controlled (not cartesian) role+location combinations. */
describe("buildHimalayasSearchQueryPlan (Phase 8.5.7 §2/§3/§6)", () => {
  it("[D] never exceeds MAX_SEARCH_QUERIES_PER_SOURCE by default", () => {
    const plan = buildHimalayasSearchQueryPlan();
    expect(plan.length).toBeLessThanOrEqual(MAX_SEARCH_QUERIES_PER_SOURCE);
    expect(plan.length).toBe(8);
  });

  it("orders queries Tier 1 -> Tier 2 -> Tier 4 -> Tier 3, matching the search priority order", () => {
    const plan = buildHimalayasSearchQueryPlan();
    const tierSequence = plan.map((spec) => spec.tier);
    expect(tierSequence).toEqual(["TIER_1", "TIER_1", "TIER_1", "TIER_2", "TIER_2", "TIER_4", "TIER_4", "TIER_3"]);
  });

  it("respects a smaller caller-supplied cap without exceeding it", () => {
    const plan = buildHimalayasSearchQueryPlan(3);
    expect(plan).toHaveLength(3);
    expect(plan.every((spec) => spec.tier === "TIER_1")).toBe(true);
  });

  it("pairs each role phrase with a controlled location modifier (Pakistan/UAE/none) — not a full cartesian product of roles x locations x modes", () => {
    const plan = buildHimalayasSearchQueryPlan();
    for (const spec of plan) {
      expect(spec.query.startsWith(spec.roleKeyword)).toBe(true);
      if (spec.locationModifier) {
        expect(["Pakistan", "UAE"]).toContain(spec.locationModifier);
        expect(spec.query).toBe(`${spec.roleKeyword} ${spec.locationModifier}`);
      } else {
        expect(spec.query).toBe(spec.roleKeyword);
      }
    }
  });
});

describe("createHimalayasJobSource — multi-query execution (Phase 8.5.7 §2/§9)", () => {
  it("issues at most MAX_SEARCH_QUERIES_PER_SOURCE fetch calls per searchJobs() call, all against the documented endpoint", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [] }));
    const source = createHimalayasJobSource({ fetchImpl });

    await source.searchJobs({});

    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(MAX_SEARCH_QUERIES_PER_SOURCE);
    expect(fetchImpl.mock.calls.length).toBe(8);
    for (const call of fetchImpl.mock.calls) {
      expect((call[0] as string).toString()).toContain("himalayas.app/jobs/api/search");
    }
  });

  it("de-duplicates the same raw job id returned by more than one targeted query", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [rawHimalayasJob({ id: 7001 })] }));
    const source = createHimalayasJobSource({ fetchImpl, maxSearchQueries: 4 });

    const jobs = await source.searchJobs({});
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(jobs).toHaveLength(1); // same id 7001 across all 4 queries collapses to one entry
  });

  it("isolates a single failing query — other queries' results still come back", async () => {
    let callIndex = 0;
    const fetchImpl = vi.fn(async () => {
      callIndex += 1;
      if (callIndex === 1) {
        throw new TypeError("fetch failed");
      }
      return jsonResponse({ jobs: [rawHimalayasJob({ id: `ok-${callIndex}` })] });
    });
    const source = createHimalayasJobSource({ fetchImpl, maxSearchQueries: 3 });

    const jobs = await source.searchJobs({});
    expect(jobs).toHaveLength(2); // queries 2 and 3 succeeded; query 1's failure was isolated
  });

  it("re-throws the first captured error, correctly classified, only when every query fails", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 403));
    const source = createHimalayasJobSource({ fetchImpl, maxSearchQueries: 2 });

    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceAuthError);
  });
});

describe("createHimalayasJobSource.normalize / getJob", () => {
  it("normalize() delegates to normalizeHimalayasJob", () => {
    const source = createHimalayasJobSource();
    expect((source.normalize(rawHimalayasJob()) as Record<string, unknown>).source).toBe("himalayas");
  });

  it("getJob always returns null (no live lookup implemented)", async () => {
    const source = createHimalayasJobSource();
    await expect(source.getJob("5001")).resolves.toBeNull();
  });
});
