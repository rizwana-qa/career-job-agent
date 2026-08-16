import { describe, expect, it, vi } from "vitest";
import { createRemoteOkJobSource, normalizeRemoteOkJob, type RemoteOkRawJob } from "../../src/jobSources/remoteOkJobSource.js";
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

function rawRemoteOkJob(overrides: Partial<RemoteOkRawJob> = {}): RemoteOkRawJob {
  return {
    id: 9001,
    company: "Driftwood Systems",
    position: "SDET",
    tags: ["qa", "automation", "playwright"],
    location: "Worldwide",
    date: "2026-08-10",
    url: "https://remoteok.com/remote-jobs/9001-sdet-driftwood-systems",
    description: "Build and maintain automated test suites across our web and API surfaces using Playwright.",
    salary_min: 70000,
    salary_max: 90000,
    ...overrides
  };
}

describe("normalizeRemoteOkJob", () => {
  it("normalizes a well-formed raw Remote OK job into the common Job shape", () => {
    const normalized = normalizeRemoteOkJob(rawRemoteOkJob()) as Record<string, unknown>;
    expect(normalized).toMatchObject({
      jobTitle: "SDET",
      company: "Driftwood Systems",
      remoteStatus: "REMOTE",
      employmentType: "FULL_TIME",
      source: "remoteok",
      sourceUrl: "https://remoteok.com/remote-jobs/9001-sdet-driftwood-systems",
      datePosted: "2026-08-10",
      externalJobId: "9001",
      salary: 80000,
      currency: "USD"
    });
  });

  it("drops the API's leading non-job legal/notice entry (missing position/company/url)", () => {
    expect(normalizeRemoteOkJob({ legal: "https://remoteok.com/legal" } as RemoteOkRawJob)).toBeNull();
  });

  it("returns null when url is missing — never fabricates one", () => {
    expect(normalizeRemoteOkJob(rawRemoteOkJob({ url: undefined }))).toBeNull();
  });

  it("returns null when the description is too short", () => {
    expect(normalizeRemoteOkJob(rawRemoteOkJob({ description: "short" }))).toBeNull();
  });
});

describe("createRemoteOkJobSource — searchJobs", () => {
  it("requests the documented public endpoint and returns the raw array", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ legal: "notice" }, rawRemoteOkJob()]));
    const source = createRemoteOkJobSource({ fetchImpl });

    const jobs = await source.searchJobs({});
    expect(jobs).toHaveLength(2); // raw array as-is — normalize() is what drops the legal entry
    expect((fetchImpl.mock.calls[0][0] as string).toString()).toContain("remoteok.com/api");
  });

  it("throws JobSourceTimeoutError when the request aborts", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    await expect(createRemoteOkJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceTimeoutError);
  });

  it("throws JobSourceUnavailableError on a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(createRemoteOkJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceUnavailableError);
  });

  it("throws JobSourceAuthError on HTTP 401/403", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    await expect(createRemoteOkJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceAuthError);
  });

  it("throws JobSourceRateLimitError on HTTP 429", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429));
    await expect(createRemoteOkJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceRateLimitError);
  });

  it("throws a generic JobSourceError on an unexpected non-OK status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    await expect(createRemoteOkJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceError);
  });

  it("throws InvalidJobSourceResponseError when the response isn't an array", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [] }));
    await expect(createRemoteOkJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(InvalidJobSourceResponseError);
  });
});

describe("createRemoteOkJobSource.normalize / getJob", () => {
  it("normalize() delegates to normalizeRemoteOkJob", () => {
    const source = createRemoteOkJobSource();
    expect((source.normalize(rawRemoteOkJob()) as Record<string, unknown>).source).toBe("remoteok");
  });

  it("getJob always returns null (no live lookup implemented)", async () => {
    await expect(createRemoteOkJobSource().getJob("9001")).resolves.toBeNull();
  });
});
