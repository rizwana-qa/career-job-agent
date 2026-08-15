import { describe, expect, it } from "vitest";
import { loadJobsFromInput } from "../../src/services/jobSourceService.js";
import { loadAllJobFixtures } from "../helpers/fixtures.js";

describe("jobSourceService.loadJobsFromInput", () => {
  it("accepts all 10 fixture jobs as valid", () => {
    const fixtures = loadAllJobFixtures();
    const { validJobs, invalidJobs } = loadJobsFromInput(fixtures);

    expect(validJobs).toHaveLength(fixtures.length);
    expect(invalidJobs).toHaveLength(0);
  });

  it("separates valid jobs from invalid ones instead of rejecting the whole batch", () => {
    const fixtures = loadAllJobFixtures();
    const malformed = { jobTitle: "Broken Job" };

    const { validJobs, invalidJobs } = loadJobsFromInput([...fixtures, malformed]);

    expect(validJobs).toHaveLength(fixtures.length);
    expect(invalidJobs).toHaveLength(1);
    expect(invalidJobs[0].index).toBe(fixtures.length);
    expect(invalidJobs[0].errors.length).toBeGreaterThan(0);
  });

  it("returns an empty result for an empty array", () => {
    const { validJobs, invalidJobs } = loadJobsFromInput([]);
    expect(validJobs).toHaveLength(0);
    expect(invalidJobs).toHaveLength(0);
  });

  it("reports useful, path-labeled validation errors", () => {
    const { invalidJobs } = loadJobsFromInput([{ jobTitle: "" }]);
    expect(invalidJobs[0].errors.some((e) => e.startsWith("jobTitle:"))).toBe(true);
  });
});
