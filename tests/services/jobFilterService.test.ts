import { describe, expect, it } from "vitest";
import { deduplicateJobs, filterEligibleJobs, mergeFilterOptions } from "../../src/services/jobFilterService.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";
import { loadAllJobFixtures, loadJobFixture } from "../helpers/fixtures.js";

function parseFixture(filename: string): Job {
  const raw = loadJobFixture(filename);
  const result = JobSchema.parse(raw);
  return result;
}

function allFixtureJobs(): Job[] {
  return loadAllJobFixtures().map((raw) => JobSchema.parse(raw));
}

describe("jobFilterService.deduplicateJobs", () => {
  it("keeps all 10 fixtures — none are duplicates of each other", () => {
    const jobs = allFixtureJobs();
    expect(deduplicateJobs(jobs)).toHaveLength(jobs.length);
  });

  it("removes an exact duplicate by externalJobId", () => {
    const job = parseFixture("01-principal-qa-engineer.json");
    const duplicate: Job = { ...job, sourceUrl: "https://example.com/jobs/some-other-mirror" };
    const result = deduplicateJobs([job, duplicate]);
    expect(result).toHaveLength(1);
  });

  it("removes an exact duplicate by sourceUrl when externalJobId is absent", () => {
    const job = parseFixture("03-qa-architect.json");
    const { externalJobId, ...withoutId } = job;
    void externalJobId;
    const duplicate: Job = { ...withoutId };
    const result = deduplicateJobs([withoutId as Job, duplicate]);
    expect(result).toHaveLength(1);
  });

  it("does not merge two genuinely different jobs", () => {
    const jobA = parseFixture("01-principal-qa-engineer.json");
    const jobB = parseFixture("02-staff-qa-engineer.json");
    expect(deduplicateJobs([jobA, jobB])).toHaveLength(2);
  });
});

describe("jobFilterService.filterEligibleJobs", () => {
  it("passes through unrelated-role and low-signal checks for the 9 QA-related fixtures", () => {
    const jobs = allFixtureJobs().filter((job) => job.jobTitle !== "Regional Sales Manager");
    const { eligible, rejected } = filterEligibleJobs(jobs);

    const unrelatedRejections = rejected.filter((r) =>
      r.reasons.some((reason) => reason.includes("no QA/testing/quality-related signal"))
    );
    expect(unrelatedRejections).toHaveLength(0);
    expect(eligible.length + rejected.length).toBe(jobs.length);
  });

  it("rejects a clearly unrelated role (Regional Sales Manager fixture)", () => {
    const job = parseFixture("10-unrelated-low-match.json");
    const { eligible, rejected } = filterEligibleJobs([job]);

    expect(eligible).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reasons.some((r) => r.includes("no QA/testing/quality-related signal"))).toBe(true);
  });

  it("rejects a clearly junior role by title", () => {
    const base = parseFixture("07-senior-sdet.json");
    const juniorJob: Job = { ...base, jobTitle: "Junior QA Tester" };
    const { eligible, rejected } = filterEligibleJobs([juniorJob]);

    expect(eligible).toHaveLength(0);
    expect(rejected[0].reasons.some((r) => r.includes("junior/entry-level"))).toBe(true);
  });

  it("does not reject a job merely because a preferred (non-required) qualification is absent", () => {
    // 06 requires Python, which the candidate profile doesn't evidence — the
    // deterministic filter must not reject on missing-qualification grounds;
    // that judgment belongs to Claude, not this layer.
    const job = parseFixture("06-llm-evaluation-engineer.json");
    const { eligible, rejected } = filterEligibleJobs([job]);
    expect(eligible).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("filters out a job whose country is not in an explicit allow-list and isn't remote", () => {
    const job = parseFixture("07-senior-sdet.json"); // ONSITE, United States
    const { eligible, rejected } = filterEligibleJobs([job], {
      allowedCountries: ["Pakistan", "UAE"]
    });

    expect(eligible).toHaveLength(0);
    expect(rejected[0].reasons.some((r) => r.includes("is not in the supported country list"))).toBe(true);
  });

  it("allows a REMOTE job through the location filter even if its listed country isn't in the allow-list", () => {
    const job = parseFixture("04-ai-quality-engineer.json"); // REMOTE, United States
    const { eligible } = filterEligibleJobs([job], {
      allowedCountries: ["Pakistan", "UAE"],
      allowRemoteAnyCountry: true
    });

    expect(eligible).toHaveLength(1);
  });

  it("rejects a job with disclosed salary below an explicit minimum", () => {
    const job = parseFixture("09-automation-architect.json"); // salary 98000 EUR
    const { eligible, rejected } = filterEligibleJobs([job], { minimumSalary: 150000 });

    expect(eligible).toHaveLength(0);
    expect(rejected[0].reasons.some((r) => r.includes("below the minimum"))).toBe(true);
  });

  it("does not reject a job with no disclosed salary, even with a minimum configured", () => {
    const job = parseFixture("03-qa-architect.json"); // no salary field
    const { eligible, rejected } = filterEligibleJobs([job], { minimumSalary: 150000 });

    expect(eligible).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("flags a job with an empty job description", () => {
    const base = parseFixture("01-principal-qa-engineer.json");
    const brokenJob = { ...base, jobDescription: "" } as Job;
    const { rejected } = filterEligibleJobs([brokenJob]);
    expect(rejected[0].reasons).toContain("job description is missing");
  });
});

describe("jobFilterService.mergeFilterOptions", () => {
  it("falls back to the file default for any key the caller doesn't supply", () => {
    const defaults = { allowedCountries: ["Pakistan", "UAE"], allowRemoteAnyCountry: true };
    const merged = mergeFilterOptions(defaults, { minimumSalary: 100000 });

    expect(merged.allowedCountries).toEqual(["Pakistan", "UAE"]);
    expect(merged.allowRemoteAnyCountry).toBe(true);
    expect(merged.minimumSalary).toBe(100000);
  });

  it("lets an explicitly supplied caller value override the file default", () => {
    const defaults = { allowedCountries: ["Pakistan", "UAE"] };
    const merged = mergeFilterOptions(defaults, { allowedCountries: ["Germany"] });

    expect(merged.allowedCountries).toEqual(["Germany"]);
  });

  it("returns the defaults unchanged when no overrides are given", () => {
    const defaults = { allowedCountries: ["Pakistan"], minimumSalary: 50000 };
    expect(mergeFilterOptions(defaults)).toEqual(defaults);
  });

  it("does not mutate the original defaults object", () => {
    const defaults = { allowedCountries: ["Pakistan"] };
    mergeFilterOptions(defaults, { allowedCountries: ["UAE"] });
    expect(defaults.allowedCountries).toEqual(["Pakistan"]);
  });
});

describe("jobFilterService.filterEligibleJobs — Phase 6 additions (rolesToAvoid / excludedIndustries)", () => {
  it("rejects a job whose title matches an explicitly avoided role", () => {
    const job = parseFixture("01-principal-qa-engineer.json");
    const { eligible, rejected } = filterEligibleJobs([job], { rolesToAvoid: ["Principal QA Engineer"] });

    expect(eligible).toHaveLength(0);
    expect(rejected[0].reasons.some((r) => r.includes("explicitly avoided role"))).toBe(true);
  });

  it("does not reject a job when rolesToAvoid doesn't match its title", () => {
    const job = parseFixture("01-principal-qa-engineer.json");
    const { eligible } = filterEligibleJobs([job], { rolesToAvoid: ["Sales Manager"] });
    expect(eligible).toHaveLength(1);
  });

  it("rejects a job whose company/description matches an excluded industry", () => {
    const job = parseFixture("10-unrelated-low-match.json"); // company: Crestline Beverages
    const { rejected } = filterEligibleJobs([job], { excludedIndustries: ["Beverages"] });
    expect(rejected.some((r) => r.reasons.some((reason) => reason.includes("excluded industry")))).toBe(true);
  });

  it("does not reject jobs when rolesToAvoid/excludedIndustries are omitted (backward compatible with Phase 2)", () => {
    const jobs = allFixtureJobs().filter((j) => j.jobTitle !== "Regional Sales Manager");
    const { rejected } = filterEligibleJobs(jobs);
    const newReasonRejections = rejected.filter((r) =>
      r.reasons.some((reason) => reason.includes("avoided role") || reason.includes("excluded industry"))
    );
    expect(newReasonRejections).toHaveLength(0);
  });
});
