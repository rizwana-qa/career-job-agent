import { describe, expect, it } from "vitest";
import { JobSchema } from "../../src/schemas/job.js";
import { loadAllJobFixtures, loadJobFixture } from "../helpers/fixtures.js";

describe("JobSchema", () => {
  it("accepts every fixture job as valid", () => {
    const fixtures = loadAllJobFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(10);

    for (const fixture of fixtures) {
      const result = JobSchema.safeParse(fixture);
      expect(result.success).toBe(true);
    }
  });

  it("accepts a job without optional fields", () => {
    const job = loadJobFixture("03-qa-architect.json");
    const result = JobSchema.safeParse(job);
    expect(result.success).toBe(true);
  });

  it("rejects a job missing required fields", () => {
    const result = JobSchema.safeParse({ jobTitle: "QA Engineer" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("company");
      expect(paths).toContain("jobDescription");
    }
  });

  it("rejects an invalid remoteStatus value", () => {
    const base = loadJobFixture("01-principal-qa-engineer.json") as Record<string, unknown>;
    const result = JobSchema.safeParse({ ...base, remoteStatus: "FLEXIBLE" });
    expect(result.success).toBe(false);
  });

  it("rejects a jobDescription that is too short", () => {
    const base = loadJobFixture("01-principal-qa-engineer.json") as Record<string, unknown>;
    const result = JobSchema.safeParse({ ...base, jobDescription: "Too short" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid sourceUrl", () => {
    const base = loadJobFixture("01-principal-qa-engineer.json") as Record<string, unknown>;
    const result = JobSchema.safeParse({ ...base, sourceUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty requirements array", () => {
    const base = loadJobFixture("01-principal-qa-engineer.json") as Record<string, unknown>;
    const result = JobSchema.safeParse({ ...base, requirements: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed datePosted", () => {
    const base = loadJobFixture("01-principal-qa-engineer.json") as Record<string, unknown>;
    const result = JobSchema.safeParse({ ...base, datePosted: "July 2026" });
    expect(result.success).toBe(false);
  });

  it("accepts optional salary and currency when provided", () => {
    const job = loadJobFixture("01-principal-qa-engineer.json");
    const result = JobSchema.safeParse(job);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.salary).toBe(195000);
      expect(result.data.currency).toBe("USD");
    }
  });
});
