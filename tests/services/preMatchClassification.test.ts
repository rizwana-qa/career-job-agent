import { describe, expect, it } from "vitest";
import { JobSchema, type Job } from "../../src/schemas/job.js";
import { classifyPreMatchOutcome, buildPreMatchDiagnostics } from "../../src/services/preMatchClassification.js";

let counter = 0;
function job(title: string, overrides: Record<string, unknown> = {}): Job {
  counter += 1;
  return JobSchema.parse({
    jobTitle: title,
    company: "Test Co",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: "A sufficiently long job description for schema validation purposes across every test case here.",
    requirements: ["See description"],
    responsibilities: ["See description"],
    skills: ["Testing"],
    source: "himalayas",
    sourceUrl: `https://himalayas.example/${counter}`,
    datePosted: "2026-08-10",
    externalJobId: String(counter),
    ...overrides
  });
}

/** Passes every stage — location eligible, not hard negative, not non-software-QA, has a strong positive title signal. */
function qualifiedJob(overrides: Record<string, unknown> = {}): Job {
  return job("Senior QA Engineer", overrides);
}

/** Fails ONLY location eligibility (REMOTE + explicitly US-only). */
function locationRejectedJob(overrides: Record<string, unknown> = {}): Job {
  return job("Senior QA Engineer", { location: "Remote (US only)", country: "United States", ...overrides });
}

/** Fails ONLY the hard-negative title filter. */
function hardNegativeJob(overrides: Record<string, unknown> = {}): Job {
  return job("Tier III Service Desk Engineer", overrides);
}

/** Fails ONLY the non-software-QA filter. */
function nonSoftwareQaJob(overrides: Record<string, unknown> = {}): Job {
  return job("Manufacturing QA Technician", overrides);
}

/** Fails ONLY the positive career signal check (generic title, generic description, no secondary signals). */
function positiveCareerRejectedJob(overrides: Record<string, unknown> = {}): Job {
  return job("Sales Representative", {
    jobDescription: "Generate pipeline and close new business for our SaaS product across target accounts.",
    skills: ["Sales"],
    responsibilities: ["Prospecting"],
    ...overrides
  });
}

describe("classifyPreMatchOutcome — single deterministic outcome per job (Phase 8.5.17 §2)", () => {
  it("[A] 2 of 10 jobs fail location eligibility -> locationRejected = 2", () => {
    const jobs = [...Array.from({ length: 2 }, () => locationRejectedJob()), ...Array.from({ length: 8 }, () => qualifiedJob())];
    const diagnostics = buildPreMatchDiagnostics(jobs);
    expect(diagnostics.locationRejected).toBe(2);
    expect(diagnostics.qualifiedForMatching).toBe(8);
  });

  it("[B] 2 of 10 jobs fail the hard negative filter -> hardNegativeRejected = 2", () => {
    const jobs = [...Array.from({ length: 2 }, () => hardNegativeJob()), ...Array.from({ length: 8 }, () => qualifiedJob())];
    const diagnostics = buildPreMatchDiagnostics(jobs);
    expect(diagnostics.hardNegativeRejected).toBe(2);
    expect(diagnostics.qualifiedForMatching).toBe(8);
  });

  it("[C] 2 of 10 jobs fail the non-software-QA filter -> nonSoftwareQaRejected = 2", () => {
    const jobs = [...Array.from({ length: 2 }, () => nonSoftwareQaJob()), ...Array.from({ length: 8 }, () => qualifiedJob())];
    const diagnostics = buildPreMatchDiagnostics(jobs);
    expect(diagnostics.nonSoftwareQaRejected).toBe(2);
    expect(diagnostics.qualifiedForMatching).toBe(8);
  });

  it("[D] 2 of 10 jobs fail the positive career signal check -> positiveCareerRejected = 2", () => {
    const jobs = [...Array.from({ length: 2 }, () => positiveCareerRejectedJob()), ...Array.from({ length: 8 }, () => qualifiedJob())];
    const diagnostics = buildPreMatchDiagnostics(jobs);
    expect(diagnostics.positiveCareerRejected).toBe(2);
    expect(diagnostics.qualifiedForMatching).toBe(8);
  });

  it("[E] 2 of 10 jobs qualify -> qualifiedForMatching = 2", () => {
    const jobs = [
      ...Array.from({ length: 2 }, () => qualifiedJob()),
      ...Array.from({ length: 3 }, () => locationRejectedJob()),
      ...Array.from({ length: 3 }, () => hardNegativeJob()),
      ...Array.from({ length: 2 }, () => nonSoftwareQaJob())
    ];
    const diagnostics = buildPreMatchDiagnostics(jobs);
    expect(diagnostics.qualifiedForMatching).toBe(2);
  });

  it("[F] a job failing multiple rules is counted only once, under the FIRST failing stage (location, checked before hard negative)", () => {
    // "System Administrator" is a hard-negative title AND explicitly US-only remote — location is checked first.
    const multiFailJob = job("System Administrator", { location: "Remote (US only)", country: "United States" });
    expect(classifyPreMatchOutcome(multiFailJob)).toBe("LOCATION_REJECTED");

    const diagnostics = buildPreMatchDiagnostics([multiFailJob]);
    expect(diagnostics.locationRejected).toBe(1);
    expect(diagnostics.hardNegativeRejected).toBe(0);
  });

  it("[G] tier counts reconcile: afterBasicFilter tally sums to the total, qualifiedForMatching tally sums to the qualified count", () => {
    const jobs = [
      job("Principal QA Engineer"), // TIER_1, qualifies
      job("Lead QA Engineer"), // TIER_2, qualifies
      job("AI Quality Engineer"), // TIER_4, qualifies
      job("Senior QA Engineer"), // TIER_3, qualifies
      job("QA Engineer"), // UNTIERED, qualifies
      hardNegativeJob(), // UNTIERED, rejected — never counted in qualifiedForMatching's tier tally
      locationRejectedJob() // TIER_3-shaped title, but rejected — never counted in qualifiedForMatching's tier tally
    ];
    const diagnostics = buildPreMatchDiagnostics(jobs);

    const afterBasicFilterTotal = Object.values(diagnostics.byTier.afterBasicFilter).reduce((a, b) => a + b, 0);
    expect(afterBasicFilterTotal).toBe(jobs.length);

    const qualifiedTierTotal = Object.values(diagnostics.byTier.qualifiedForMatching).reduce((a, b) => a + b, 0);
    expect(qualifiedTierTotal).toBe(diagnostics.qualifiedForMatching);

    expect(diagnostics.byTier.afterBasicFilter.TIER_1).toBe(1);
    expect(diagnostics.byTier.afterBasicFilter.TIER_2).toBe(1);
    expect(diagnostics.byTier.afterBasicFilter.TIER_4).toBe(1);
    // TIER_3: Senior QA Engineer (qualifies) + locationRejectedJob (also "Senior QA Engineer" title, rejected) = 2
    expect(diagnostics.byTier.afterBasicFilter.TIER_3).toBe(2);
    // qualifiedForMatching's tier tally excludes the rejected TIER_3 job.
    expect(diagnostics.byTier.qualifiedForMatching.TIER_3).toBe(1);
  });

  it("[H] source counts reconcile: afterBasicFilter/qualified/rejected sum correctly per source", () => {
    const jobs = [
      qualifiedJob({ source: "himalayas" }),
      qualifiedJob({ source: "himalayas" }),
      hardNegativeJob({ source: "himalayas" }),
      qualifiedJob({ source: "remoteok" }),
      locationRejectedJob({ source: "remoteok" }),
      locationRejectedJob({ source: "remoteok" })
    ];
    const diagnostics = buildPreMatchDiagnostics(jobs);

    expect(diagnostics.bySource.himalayas).toEqual({ afterBasicFilter: 3, qualified: 2, rejected: 1 });
    expect(diagnostics.bySource.remoteok).toEqual({ afterBasicFilter: 3, qualified: 1, rejected: 2 });

    for (const breakdown of Object.values(diagnostics.bySource)) {
      expect(breakdown.qualified + breakdown.rejected).toBe(breakdown.afterBasicFilter);
    }
  });
});

/** Phase 8.5.17 §9 — reconciliation invariants, verified against a larger, more realistic mixed batch. */
describe("buildPreMatchDiagnostics — reconciliation invariants (Phase 8.5.17 §9)", () => {
  it("jobsAfterFiltering equals the sum of all five outcome counters", () => {
    const jobs = [
      ...Array.from({ length: 4 }, () => locationRejectedJob()),
      ...Array.from({ length: 5 }, () => hardNegativeJob()),
      ...Array.from({ length: 3 }, () => nonSoftwareQaJob()),
      ...Array.from({ length: 6 }, () => positiveCareerRejectedJob()),
      ...Array.from({ length: 7 }, () => qualifiedJob())
    ];
    const diagnostics = buildPreMatchDiagnostics(jobs);
    const sum =
      diagnostics.locationRejected +
      diagnostics.hardNegativeRejected +
      diagnostics.nonSoftwareQaRejected +
      diagnostics.positiveCareerRejected +
      diagnostics.qualifiedForMatching;
    expect(sum).toBe(jobs.length);
    expect(diagnostics.locationRejected).toBe(4);
    expect(diagnostics.hardNegativeRejected).toBe(5);
    expect(diagnostics.nonSoftwareQaRejected).toBe(3);
    expect(diagnostics.positiveCareerRejected).toBe(6);
    expect(diagnostics.qualifiedForMatching).toBe(7);
  });

  it("an empty job list produces all-zero counters, never throwing", () => {
    const diagnostics = buildPreMatchDiagnostics([]);
    expect(diagnostics.qualifiedForMatching).toBe(0);
    expect(diagnostics.locationRejected).toBe(0);
    expect(diagnostics.byTier.afterBasicFilter).toEqual({});
    expect(diagnostics.bySource).toEqual({});
  });
});
