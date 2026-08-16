import { describe, expect, it, vi } from "vitest";
import { createHimalayasJobSource, normalizeHimalayasJob, type HimalayasRawJob } from "../../src/jobSources/himalayasJobSource.js";
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
