import { describe, expect, it } from "vitest";
import { normalizeNaukrigulfJob, createNaukrigulfJobSource, type NaukrigulfRawJob } from "../../src/jobSources/naukrigulfJobSource.js";
import { JobSourceUnavailableError } from "../../src/utils/errors.js";

function rawNaukrigulfJob(overrides: Partial<NaukrigulfRawJob> = {}): NaukrigulfRawJob {
  return {
    jobId: "ng-9001",
    title: "QA Automation Lead",
    companyName: "Emirates Digital Solutions",
    location: "Abu Dhabi, UAE",
    country: "UAE",
    jobDescription: "Lead our automation testing strategy across web and mobile applications for a growing fintech team.",
    employmentType: "Full Time",
    salaryDetail: { minimumSalary: 15000, maximumSalary: 20000, currency: "AED" },
    createdDate: "2026-08-05",
    jdURL: "https://www.naukrigulf.com/jobs/qa-automation-lead-9001",
    isRemote: false,
    ...overrides
  };
}

describe("normalizeNaukrigulfJob", () => {
  it("normalizes a well-formed raw Naukrigulf job into the common Job shape", () => {
    const normalized = normalizeNaukrigulfJob(rawNaukrigulfJob()) as Record<string, unknown>;
    expect(normalized).toMatchObject({
      jobTitle: "QA Automation Lead",
      company: "Emirates Digital Solutions",
      location: "Abu Dhabi, UAE",
      country: "UAE",
      remoteStatus: "ONSITE",
      employmentType: "FULL_TIME",
      source: "naukrigulf",
      sourceUrl: "https://www.naukrigulf.com/jobs/qa-automation-lead-9001",
      datePosted: "2026-08-05",
      externalJobId: "ng-9001",
      salary: 17500,
      currency: "AED"
    });
  });

  it("marks remoteStatus REMOTE when isRemote is true", () => {
    const normalized = normalizeNaukrigulfJob(rawNaukrigulfJob({ isRemote: true })) as Record<string, unknown>;
    expect(normalized.remoteStatus).toBe("REMOTE");
  });

  it("derives country from a comma-separated location when country is absent", () => {
    const normalized = normalizeNaukrigulfJob(rawNaukrigulfJob({ country: undefined, location: "Islamabad, Pakistan" })) as Record<
      string,
      unknown
    >;
    expect(normalized.country).toBe("Pakistan");
  });

  it("returns null for an unrecognized employment type", () => {
    expect(normalizeNaukrigulfJob(rawNaukrigulfJob({ employmentType: "Gig" }))).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(normalizeNaukrigulfJob(rawNaukrigulfJob({ title: undefined }))).toBeNull();
    expect(normalizeNaukrigulfJob(rawNaukrigulfJob({ jobDescription: "too short" }))).toBeNull();
  });
});

describe("createNaukrigulfJobSource", () => {
  it("throws JobSourceUnavailableError from searchJobs — no documented public API is available yet", async () => {
    const source = createNaukrigulfJobSource();
    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceUnavailableError);
  });

  it("getJob always returns null (no live lookup implemented)", async () => {
    const source = createNaukrigulfJobSource();
    await expect(source.getJob("ng-9001")).resolves.toBeNull();
  });
});
