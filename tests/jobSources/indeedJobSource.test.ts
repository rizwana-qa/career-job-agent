import { describe, expect, it } from "vitest";
import { normalizeIndeedJob, createIndeedJobSource, type IndeedRawJob } from "../../src/jobSources/indeedJobSource.js";
import { JobSourceUnavailableError } from "../../src/utils/errors.js";

function rawIndeedJob(overrides: Partial<IndeedRawJob> = {}): IndeedRawJob {
  return {
    jobkey: "abc123",
    jobtitle: "Senior QA Engineer",
    company: "Gulf Tech LLC",
    formattedLocation: "Dubai, United Arab Emirates",
    city: "Dubai",
    country: "United Arab Emirates",
    snippet: "We are hiring a Senior QA Engineer to lead test automation efforts across our platform.",
    url: "https://www.indeed.com/viewjob?jk=abc123",
    date: "2026-08-10",
    jobType: "fulltime",
    salary: "$70,000 - $90,000 a year",
    ...overrides
  };
}

describe("normalizeIndeedJob", () => {
  it("normalizes a well-formed raw Indeed job into the common Job shape", () => {
    const normalized = normalizeIndeedJob(rawIndeedJob()) as Record<string, unknown>;
    expect(normalized).toMatchObject({
      jobTitle: "Senior QA Engineer",
      company: "Gulf Tech LLC",
      location: "Dubai, United Arab Emirates",
      country: "United Arab Emirates",
      employmentType: "FULL_TIME",
      source: "indeed",
      sourceUrl: "https://www.indeed.com/viewjob?jk=abc123",
      datePosted: "2026-08-10",
      externalJobId: "abc123",
      salary: 80000,
      currency: "USD"
    });
  });

  it("returns null for an unrecognized employment type", () => {
    expect(normalizeIndeedJob(rawIndeedJob({ jobType: "seasonal" }))).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(normalizeIndeedJob(rawIndeedJob({ jobtitle: undefined }))).toBeNull();
    expect(normalizeIndeedJob(rawIndeedJob({ jobkey: undefined }))).toBeNull();
    expect(normalizeIndeedJob(rawIndeedJob({ snippet: "too short" }))).toBeNull();
  });
});

describe("createIndeedJobSource", () => {
  it("throws JobSourceUnavailableError from searchJobs — no documented public API is available yet", async () => {
    const source = createIndeedJobSource();
    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceUnavailableError);
  });

  it("getJob always returns null (no live lookup implemented)", async () => {
    const source = createIndeedJobSource();
    await expect(source.getJob("abc123")).resolves.toBeNull();
  });

  it("normalize() delegates to normalizeIndeedJob", () => {
    const source = createIndeedJobSource();
    const normalized = source.normalize(rawIndeedJob()) as Record<string, unknown>;
    expect(normalized.source).toBe("indeed");
  });
});
