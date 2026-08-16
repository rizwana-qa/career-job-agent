import { describe, expect, it, vi } from "vitest";
import { createJobicyJobSource, normalizeJobicyJob, type JobicyRawJob } from "../../src/jobSources/jobicyJobSource.js";
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

function rawJobicyJob(overrides: Partial<JobicyRawJob> = {}): JobicyRawJob {
  return {
    id: 7001,
    url: "https://jobicy.com/jobs/7001-ai-quality-engineer",
    jobTitle: "AI Quality Engineer",
    companyName: "Solace AI",
    jobGeo: "Worldwide",
    jobType: ["full-time"],
    jobDescription: "Design and run evaluation suites for our LLM-powered assistant, covering RAG testing and AI agent testing.",
    pubDate: "2026-08-10T00:00:00Z",
    annualSalaryMin: 75000,
    annualSalaryMax: 95000,
    salaryCurrency: "USD",
    ...overrides
  };
}

describe("normalizeJobicyJob", () => {
  it("normalizes a well-formed raw Jobicy job into the common Job shape", () => {
    const normalized = normalizeJobicyJob(rawJobicyJob()) as Record<string, unknown>;
    expect(normalized).toMatchObject({
      jobTitle: "AI Quality Engineer",
      company: "Solace AI",
      remoteStatus: "REMOTE",
      employmentType: "FULL_TIME",
      source: "jobicy",
      sourceUrl: "https://jobicy.com/jobs/7001-ai-quality-engineer",
      datePosted: "2026-08-10",
      externalJobId: "7001",
      salary: 85000,
      currency: "USD"
    });
  });

  it("falls back to jobExcerpt when jobDescription is absent", () => {
    const { jobDescription, ...rest } = rawJobicyJob();
    void jobDescription;
    const normalized = normalizeJobicyJob({
      ...rest,
      jobExcerpt: "A sufficiently long excerpt describing quality engineering and AI testing responsibilities in depth."
    }) as Record<string, unknown>;
    expect(normalized.jobDescription).toContain("quality engineering");
  });

  it("returns null when url is missing — never fabricates one", () => {
    expect(normalizeJobicyJob(rawJobicyJob({ url: undefined }))).toBeNull();
  });

  it("returns null for an unrecognized employment type", () => {
    expect(normalizeJobicyJob(rawJobicyJob({ jobType: ["gig"] }))).toBeNull();
  });
});

describe("createJobicyJobSource — searchJobs", () => {
  it("requests the documented public endpoint with the result count applied", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [rawJobicyJob()] }));
    const source = createJobicyJobSource({ fetchImpl });

    const jobs = await source.searchJobs({ roleKeywords: ["AI Quality Engineer"] });
    expect(jobs).toHaveLength(1);
    const calledUrl = (fetchImpl.mock.calls[0][0] as string).toString();
    expect(calledUrl).toContain("jobicy.com/api/v2/remote-jobs");
    expect(calledUrl).toContain("count=20");
  });

  it("throws JobSourceTimeoutError when the request aborts", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    await expect(createJobicyJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceTimeoutError);
  });

  it("throws JobSourceUnavailableError on a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(createJobicyJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceUnavailableError);
  });

  it("throws JobSourceAuthError on HTTP 401/403", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 403));
    await expect(createJobicyJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceAuthError);
  });

  it("throws JobSourceRateLimitError on HTTP 429", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429));
    await expect(createJobicyJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceRateLimitError);
  });

  it("throws a generic JobSourceError on an unexpected non-OK status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    await expect(createJobicyJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceError);
  });

  it("throws InvalidJobSourceResponseError when the JSON shape is unexpected", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ notJobs: [] }));
    await expect(createJobicyJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(InvalidJobSourceResponseError);
  });
});

describe("createJobicyJobSource.normalize / getJob", () => {
  it("normalize() delegates to normalizeJobicyJob", () => {
    const source = createJobicyJobSource();
    expect((source.normalize(rawJobicyJob()) as Record<string, unknown>).source).toBe("jobicy");
  });

  it("getJob always returns null (no live lookup implemented)", async () => {
    await expect(createJobicyJobSource().getJob("7001")).resolves.toBeNull();
  });
});
