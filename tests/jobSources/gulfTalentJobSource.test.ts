import { describe, expect, it } from "vitest";
import { normalizeGulfTalentJob, createGulfTalentJobSource, type GulfTalentRawJob } from "../../src/jobSources/gulfTalentJobSource.js";
import { JobSourceUnavailableError } from "../../src/utils/errors.js";

function rawGulfTalentJob(overrides: Partial<GulfTalentRawJob> = {}): GulfTalentRawJob {
  return {
    id: 4521,
    title: "Principal Quality Engineer",
    employer: { name: "Falcon Software Group" },
    location: { city: "Dubai", country: "United Arab Emirates" },
    description: "Own quality strategy for a suite of B2B SaaS products, including test automation architecture.",
    jobType: "full_time",
    salaryMin: 25000,
    salaryMax: 30000,
    currency: "AED",
    postedDate: "2026-08-01",
    url: "https://www.gulftalent.com/jobs/principal-quality-engineer-4521",
    remote: false,
    ...overrides
  };
}

describe("normalizeGulfTalentJob", () => {
  it("normalizes a well-formed raw GulfTalent job into the common Job shape", () => {
    const normalized = normalizeGulfTalentJob(rawGulfTalentJob()) as Record<string, unknown>;
    expect(normalized).toMatchObject({
      jobTitle: "Principal Quality Engineer",
      company: "Falcon Software Group",
      location: "Dubai, United Arab Emirates",
      country: "United Arab Emirates",
      remoteStatus: "ONSITE",
      employmentType: "FULL_TIME",
      source: "gulftalent",
      sourceUrl: "https://www.gulftalent.com/jobs/principal-quality-engineer-4521",
      datePosted: "2026-08-01",
      externalJobId: "4521",
      salary: 27500,
      currency: "AED"
    });
  });

  it("marks remoteStatus REMOTE when remote is true", () => {
    const normalized = normalizeGulfTalentJob(rawGulfTalentJob({ remote: true })) as Record<string, unknown>;
    expect(normalized.remoteStatus).toBe("REMOTE");
  });

  it("falls back to country only when city is absent", () => {
    const normalized = normalizeGulfTalentJob(
      rawGulfTalentJob({ location: { country: "United Arab Emirates" } })
    ) as Record<string, unknown>;
    expect(normalized.location).toBe("United Arab Emirates");
  });

  it("returns null for an unrecognized employment type", () => {
    expect(normalizeGulfTalentJob(rawGulfTalentJob({ jobType: "gig" }))).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(normalizeGulfTalentJob(rawGulfTalentJob({ id: undefined }))).toBeNull();
    expect(normalizeGulfTalentJob(rawGulfTalentJob({ description: "too short" }))).toBeNull();
  });
});

describe("createGulfTalentJobSource", () => {
  it("throws JobSourceUnavailableError from searchJobs — no documented public API is available yet", async () => {
    const source = createGulfTalentJobSource();
    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceUnavailableError);
  });

  it("getJob always returns null (no live lookup implemented)", async () => {
    const source = createGulfTalentJobSource();
    await expect(source.getJob("4521")).resolves.toBeNull();
  });
});
