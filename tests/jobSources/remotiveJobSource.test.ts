import { describe, expect, it, vi } from "vitest";
import { createRemotiveJobSource } from "../../src/jobSources/remotiveJobSource.js";
import {
  InvalidJobSourceResponseError,
  JobSourceAuthError,
  JobSourceError,
  JobSourceRateLimitError,
  JobSourceTimeoutError,
  JobSourceUnavailableError
} from "../../src/utils/errors.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as unknown as Response;
}

function sampleJob(id: number) {
  return {
    id,
    url: `https://remotive.com/remote-jobs/qa/job-${id}`,
    title: "Quality Engineer",
    company_name: "Test Co",
    category: "Software Development",
    tags: ["qa"],
    job_type: "full_time",
    publication_date: "2026-08-10T09:15:00",
    candidate_required_location: "Worldwide",
    salary: "",
    description: "<p>A real, sufficiently long job description for testing purposes.</p>"
  };
}

describe("createRemotiveJobSource — provider configuration", () => {
  it("exposes the provider name", () => {
    const source = createRemotiveJobSource();
    expect(source.name).toBe("remotive");
  });

  it("accepts a configurable minFetchIntervalMs and category", () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [sampleJob(1)] }));
    const source = createRemotiveJobSource({ minFetchIntervalMs: 1000, category: "customer-support", fetchImpl });
    expect(source.name).toBe("remotive");
    void fetchImpl;
  });
});

describe("createRemotiveJobSource — successful discovery", () => {
  it("returns the raw jobs array from a well-formed response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [sampleJob(1), sampleJob(2)] }));
    const source = createRemotiveJobSource({ fetchImpl });

    const jobs = await source.searchJobs({});
    expect(jobs).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("makes exactly one network call per search, regardless of how many role keywords are supplied", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [sampleJob(1)] }));
    const source = createRemotiveJobSource({ fetchImpl });

    await source.searchJobs({ roleKeywords: ["A", "B", "C", "D", "E"] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached result within the throttle window instead of calling again", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [sampleJob(1)] }));
    const source = createRemotiveJobSource({ fetchImpl, minFetchIntervalMs: 60_000 });

    await source.searchJobs({});
    await source.searchJobs({});
    await source.searchJobs({});

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("makes a fresh call once the throttle window has elapsed", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [sampleJob(1)] }));
    const source = createRemotiveJobSource({ fetchImpl, minFetchIntervalMs: 1 });

    await source.searchJobs({});
    await new Promise((resolve) => setTimeout(resolve, 5));
    await source.searchJobs({});

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("createRemotiveJobSource — empty result", () => {
  it("returns an empty array when the provider has no matching jobs", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [] }));
    const source = createRemotiveJobSource({ fetchImpl });

    const jobs = await source.searchJobs({});
    expect(jobs).toEqual([]);
  });
});

describe("createRemotiveJobSource — error handling", () => {
  it("throws JobSourceTimeoutError when the request aborts", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    const source = createRemotiveJobSource({ fetchImpl });

    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceTimeoutError);
  });

  it("throws JobSourceAuthError on HTTP 401/403", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 403));
    const source = createRemotiveJobSource({ fetchImpl });

    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceAuthError);
  });

  it("throws JobSourceRateLimitError on HTTP 429", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429));
    const source = createRemotiveJobSource({ fetchImpl });

    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceRateLimitError);
  });

  it("throws JobSourceUnavailableError on a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const source = createRemotiveJobSource({ fetchImpl });

    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceUnavailableError);
  });

  it("throws a generic JobSourceError on an unexpected non-OK status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    const source = createRemotiveJobSource({ fetchImpl });

    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceError);
  });

  it("throws InvalidJobSourceResponseError when the response body is not valid JSON", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      }
    })) as unknown as typeof fetch;
    const source = createRemotiveJobSource({ fetchImpl });

    await expect(source.searchJobs({})).rejects.toBeInstanceOf(InvalidJobSourceResponseError);
  });

  it("throws InvalidJobSourceResponseError when the JSON shape is unexpected (no jobs array)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ notJobs: [] }));
    const source = createRemotiveJobSource({ fetchImpl });

    await expect(source.searchJobs({})).rejects.toBeInstanceOf(InvalidJobSourceResponseError);
  });
});

describe("createRemotiveJobSource.getJob", () => {
  it("finds a job in the current cache by id, without making a new network call", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [sampleJob(111), sampleJob(222)] }));
    const source = createRemotiveJobSource({ fetchImpl });

    await source.searchJobs({});
    const job = await source.getJob("222");

    expect(job).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null when nothing has been searched yet", async () => {
    const source = createRemotiveJobSource();
    const job = await source.getJob("999");
    expect(job).toBeNull();
  });

  it("returns null when the id isn't found in the cache", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [sampleJob(1)] }));
    const source = createRemotiveJobSource({ fetchImpl });
    await source.searchJobs({});

    expect(await source.getJob("does-not-exist")).toBeNull();
  });
});

describe("createRemotiveJobSource.normalize", () => {
  it("delegates to normalizeRemotiveJob", () => {
    const source = createRemotiveJobSource();
    const normalized = source.normalize(sampleJob(1)) as Record<string, unknown>;
    expect(normalized.jobTitle).toBe("Quality Engineer");
  });
});
