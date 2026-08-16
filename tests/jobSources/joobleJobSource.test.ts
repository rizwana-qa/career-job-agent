import { describe, expect, it } from "vitest";
import { normalizeJoobleJob, createJoobleJobSource, type JoobleRawJob } from "../../src/jobSources/joobleJobSource.js";
import { env } from "../../src/config/env.js";
import { JobSourceAuthError, JobSourceUnavailableError } from "../../src/utils/errors.js";

function rawJoobleJob(overrides: Partial<JoobleRawJob> = {}): JoobleRawJob {
  return {
    id: "jb-5501",
    title: "Automation Test Engineer",
    company: "Crescent Systems",
    location: "Islamabad, Pakistan",
    snippet: "Build and maintain our Selenium-based regression suite for a growing e-commerce platform.",
    updated: "2026-08-10",
    link: "https://jooble.org/desc/jb-5501",
    ...overrides
  };
}

describe("normalizeJoobleJob", () => {
  it("normalizes a well-formed raw Jooble job into the common Job shape", () => {
    const normalized = normalizeJoobleJob(rawJoobleJob()) as Record<string, unknown>;
    expect(normalized).toMatchObject({
      jobTitle: "Automation Test Engineer",
      company: "Crescent Systems",
      location: "Islamabad, Pakistan",
      country: "Pakistan",
      source: "jooble",
      sourceUrl: "https://jooble.org/desc/jb-5501",
      datePosted: "2026-08-10",
      externalJobId: "jb-5501"
    });
  });

  it("returns null when required fields are missing", () => {
    expect(normalizeJoobleJob(rawJoobleJob({ title: undefined }))).toBeNull();
    expect(normalizeJoobleJob(rawJoobleJob({ link: undefined }))).toBeNull();
    expect(normalizeJoobleJob(rawJoobleJob({ snippet: "too short" }))).toBeNull();
  });
});

describe("createJoobleJobSource", () => {
  it("throws JobSourceAuthError from searchJobs when no credentials are configured", async () => {
    const source = createJoobleJobSource();
    await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceAuthError);
  });

  it("getJob always returns null (no live lookup implemented)", async () => {
    await expect(createJoobleJobSource().getJob("jb-5501")).resolves.toBeNull();
  });

  it("normalize() delegates to normalizeJoobleJob", () => {
    const source = createJoobleJobSource();
    expect((source.normalize(rawJoobleJob()) as Record<string, unknown>).source).toBe("jooble");
  });
});

describe("createJoobleJobSource — with credentials configured", () => {
  it("throws JobSourceUnavailableError, not JobSourceAuthError, once JOOBLE_API_KEY exists", async () => {
    const original = env.joobleApiKey;
    env.joobleApiKey = "test-key";
    try {
      const source = createJoobleJobSource();
      await expect(source.searchJobs({})).rejects.toBeInstanceOf(JobSourceUnavailableError);
    } finally {
      env.joobleApiKey = original;
    }
  });
});
