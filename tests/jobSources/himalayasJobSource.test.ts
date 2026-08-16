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

  it("[I] returns null for an unrecognized employment type — unknown values continue to fail safely, never silently mapped", () => {
    expect(normalizeHimalayasJob(rawHimalayasJob({ employmentType: "gig" }))).toBeNull();
  });

  /**
   * Phase 8.5.20 §3 — regression cases A-H using the real values Phase
   * 8.5.19's one authorized live call confirmed the Himalayas API actually
   * returns ("Full Time", "Contractor"), plus the previously-assumed
   * snake_case values, which must keep working unchanged.
   */
  describe("employment type normalization — real observed API values (Phase 8.5.20)", () => {
    it("[A] 'Full Time' -> FULL_TIME", () => {
      const normalized = normalizeHimalayasJob(rawHimalayasJob({ employmentType: "Full Time" })) as Record<string, unknown>;
      expect(normalized.employmentType).toBe("FULL_TIME");
    });

    it("[B] 'full_time' -> FULL_TIME", () => {
      const normalized = normalizeHimalayasJob(rawHimalayasJob({ employmentType: "full_time" })) as Record<string, unknown>;
      expect(normalized.employmentType).toBe("FULL_TIME");
    });

    it("[C] 'Part Time' -> PART_TIME", () => {
      const normalized = normalizeHimalayasJob(rawHimalayasJob({ employmentType: "Part Time" })) as Record<string, unknown>;
      expect(normalized.employmentType).toBe("PART_TIME");
    });

    it("[D] 'part_time' -> PART_TIME", () => {
      const normalized = normalizeHimalayasJob(rawHimalayasJob({ employmentType: "part_time" })) as Record<string, unknown>;
      expect(normalized.employmentType).toBe("PART_TIME");
    });

    it("[E] 'Contractor' -> CONTRACT (the real API value)", () => {
      const normalized = normalizeHimalayasJob(rawHimalayasJob({ employmentType: "Contractor" })) as Record<string, unknown>;
      expect(normalized.employmentType).toBe("CONTRACT");
    });

    it("[F] 'Contract' -> CONTRACT", () => {
      const normalized = normalizeHimalayasJob(rawHimalayasJob({ employmentType: "Contract" })) as Record<string, unknown>;
      expect(normalized.employmentType).toBe("CONTRACT");
    });

    it("[G] 'Freelance' -> FREELANCE", () => {
      const normalized = normalizeHimalayasJob(rawHimalayasJob({ employmentType: "Freelance" })) as Record<string, unknown>;
      expect(normalized.employmentType).toBe("FREELANCE");
    });

    it("[H] 'Internship' -> INTERNSHIP", () => {
      const normalized = normalizeHimalayasJob(rawHimalayasJob({ employmentType: "Internship" })) as Record<string, unknown>;
      expect(normalized.employmentType).toBe("INTERNSHIP");
    });

    it("[J] a real-Himalayas-shaped sample (numeric unix-seconds pubDate, guid-only id, employmentType 'Full Time') normalizes to a valid Job", () => {
      const realShaped: HimalayasRawJob = {
        id: undefined,
        guid: "https://himalayas.app/companies/squadio/jobs/senior-qc-engineer-squadio-squad",
        title: "Senior QC Engineer - Squadio Squad",
        companyName: "Squadio",
        locationRestrictions: ["Worldwide"],
        employmentType: "Full Time",
        pubDate: 1782986675, // unix seconds, as confirmed live
        applicationLink: "https://himalayas.app/companies/squadio/jobs/senior-qc-engineer-squadio-squad",
        description:
          "Own quality engineering strategy across a growing SaaS platform, including automation, manual and API testing coverage."
      };
      const normalized = normalizeHimalayasJob(realShaped) as Record<string, unknown> | null;
      expect(normalized).not.toBeNull();
      expect(normalized).toMatchObject({
        jobTitle: "Senior QC Engineer - Squadio Squad",
        company: "Squadio",
        employmentType: "FULL_TIME",
        source: "himalayas",
        sourceUrl: "https://himalayas.app/companies/squadio/jobs/senior-qc-engineer-squadio-squad",
        externalJobId: "https://himalayas.app/companies/squadio/jobs/senior-qc-engineer-squadio-squad"
      });
      // §5 — date preservation: unix-seconds pubDate still converts correctly.
      expect(typeof (normalized as { datePosted: string }).datePosted).toBe("string");
      expect((normalized as { datePosted: string }).datePosted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
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

  it("every query is exactly the role phrase, with no appended text of any kind", () => {
    const plan = buildHimalayasSearchQueryPlan();
    for (const spec of plan) {
      expect(spec.query).toBe(spec.roleKeyword);
    }
  });
});

/**
 * Phase 8.5.12 §7 — regression cases A-G. The Phase 8.5.11 live diagnostic
 * showed appending Pakistan/UAE to the free-text `q` value did not
 * meaningfully narrow results (the same postings recurred across
 * differently-tagged queries, and ~21% of raw results were exact
 * cross-query duplicates) — so queries are now role-phrase-only text.
 * Cases H-K (location eligibility still runs downstream, a Pakistan-eligible
 * remote job survives, a US-only remote job is still rejected, cross-query
 * dedup remains intact) are covered by locationEligibilityFilter.test.ts
 * (unchanged) and the "de-duplicates the same raw job id" test above
 * (unchanged) — this file's own adapter/query-plan surface is what §7
 * actually asks to add tests for here.
 */
describe("Himalayas query text — Phase 8.5.12 §7 regression cases A-G", () => {
  const FORBIDDEN_LOCATION_WORDS = ["Pakistan", "UAE", "Dubai", "Abu Dhabi", "Worldwide", "Asia", "APAC"];

  it("[A] the Tier 1 queries contain the role phrase only", () => {
    const tier1Queries = buildHimalayasSearchQueryPlan()
      .filter((spec) => spec.tier === "TIER_1")
      .map((spec) => spec.query);
    expect(tier1Queries).toEqual(["Principal Software Quality Engineer", "Principal QA Engineer", "Principal SDET"]);
  });

  it("[B] the Tier 2 queries contain the role phrase only", () => {
    const tier2Queries = buildHimalayasSearchQueryPlan()
      .filter((spec) => spec.tier === "TIER_2")
      .map((spec) => spec.query);
    expect(tier2Queries).toEqual(["Lead QA Engineer", "Quality Engineering Lead"]);
  });

  it("[C] the Tier 4 queries contain the role phrase only", () => {
    const tier4Queries = buildHimalayasSearchQueryPlan()
      .filter((spec) => spec.tier === "TIER_4")
      .map((spec) => spec.query);
    expect(tier4Queries).toEqual(["AI Quality Engineer", "AI QA Engineer"]);
  });

  it("[D] the Tier 3 query contains the role phrase only", () => {
    const tier3Queries = buildHimalayasSearchQueryPlan()
      .filter((spec) => spec.tier === "TIER_3")
      .map((spec) => spec.query);
    expect(tier3Queries).toEqual(["Senior QA Engineer"]);
  });

  it("[E] no query contains an appended location word", () => {
    const plan = buildHimalayasSearchQueryPlan();
    for (const spec of plan) {
      for (const word of FORBIDDEN_LOCATION_WORDS) {
        expect(spec.query.toLowerCase().includes(word.toLowerCase())).toBe(false);
      }
    }
  });

  it("[F] the query plan never exceeds 8 queries", () => {
    expect(buildHimalayasSearchQueryPlan().length).toBeLessThanOrEqual(8);
    expect(buildHimalayasSearchQueryPlan()).toHaveLength(8);
  });

  it("[G] tier allocation remains TIER_1=3, TIER_2=2, TIER_4=2, TIER_3=1", () => {
    const plan = buildHimalayasSearchQueryPlan();
    const counts = plan.reduce<Record<string, number>>((acc, spec) => {
      acc[spec.tier] = (acc[spec.tier] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ TIER_1: 3, TIER_2: 2, TIER_4: 2, TIER_3: 1 });
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
