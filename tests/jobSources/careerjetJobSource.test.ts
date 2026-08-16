import { describe, expect, it } from "vitest";
import { normalizeCareerjetJob, createCareerjetJobSource, type CareerjetRawJob } from "../../src/jobSources/careerjetJobSource.js";
import { env } from "../../src/config/env.js";
import { JobSourceAuthError, JobSourceUnavailableError } from "../../src/utils/errors.js";

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
      source: "careerjet",
      sourceUrl: "https://www.careerjet.ae/jobad/cj-3301",
      datePosted: "2026-08-10",
      externalJobId: "cj-3301"
    });
  });

  it("returns null when required fields are missing", () => {
    expect(normalizeCareerjetJob(rawCareerjetJob({ title: undefined }))).toBeNull();
    expect(normalizeCareerjetJob(rawCareerjetJob({ url: undefined }))).toBeNull();
    expect(normalizeCareerjetJob(rawCareerjetJob({ description: "too short" }))).toBeNull();
  });
});

describe("createCareerjetJobSource", () => {
  it("throws JobSourceAuthError from searchJobs when no credentials are configured", async () => {
    const source = createCareerjetJobSource();
    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceAuthError);
  });

  it("getJob always returns null (no live lookup implemented)", async () => {
    await expect(createCareerjetJobSource().getJob("cj-3301")).resolves.toBeNull();
  });

  it("normalize() delegates to normalizeCareerjetJob", () => {
    const source = createCareerjetJobSource();
    expect((source.normalize(rawCareerjetJob()) as Record<string, unknown>).source).toBe("careerjet");
  });
});

// Confirms the credential check itself is exercised — searchJobs throws
// JobSourceUnavailableError (not JobSourceAuthError) once credentials are
// present, since no live request is wired in yet (Phase 8.5 §3).
describe("createCareerjetJobSource — with credentials configured", () => {
  it("throws JobSourceUnavailableError, not JobSourceAuthError, once CAREERJET_API_KEY/CAREERJET_AFFILIATE_ID exist", async () => {
    const originalKey = env.careerjetApiKey;
    const originalAffiliate = env.careerjetAffiliateId;
    env.careerjetApiKey = "test-key";
    env.careerjetAffiliateId = "test-affiliate";
    try {
      const source = createCareerjetJobSource();
      await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceUnavailableError);
    } finally {
      env.careerjetApiKey = originalKey;
      env.careerjetAffiliateId = originalAffiliate;
    }
  });
});
