import { describe, expect, it } from "vitest";
import { isHardNegativeRole } from "../../src/services/careerRelevanceFilter.js";
import type { Job } from "../../src/schemas/job.js";

function job(overrides: Partial<Job> = {}): Job {
  return {
    jobTitle: "Quality Engineer",
    company: "Remote Co",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: "A sufficiently long job description mentioning quality engineering and testing responsibilities.",
    requirements: ["Testing experience"],
    responsibilities: ["Test the product"],
    skills: ["Testing", "QA"],
    source: "remotive",
    sourceUrl: "https://remotive.com/remote-jobs/qa/job-1",
    datePosted: "2026-08-10",
    externalJobId: "1",
    ...overrides
  } as Job;
}

/**
 * Career Relevance Gate — hard negative filter test cases (Phase 8.3 §6).
 * Cases A, B, C, I. The Claude-scored gate cases (D-H, J-L) live in
 * tests/api/careerDiscoverMatch.test.ts, since they require a mocked Claude
 * response to exercise careerRelevanceScore/matchScore/recommendation.
 */
describe("isHardNegativeRole — Career Relevance Gate hard filter", () => {
  it("[A] rejects 'Tier III Service Desk Engineer' (title-based hard negative)", () => {
    expect(isHardNegativeRole(job({ jobTitle: "Tier III Service Desk Engineer" }))).toBe(true);
  });

  it("[B] rejects 'Help Desk Engineer' (title-based hard negative)", () => {
    expect(isHardNegativeRole(job({ jobTitle: "Help Desk Engineer" }))).toBe(true);
  });

  it("[C] rejects 'System Administrator' (title-based hard negative)", () => {
    expect(isHardNegativeRole(job({ jobTitle: "System Administrator" }))).toBe(true);
  });

  it("[I] does NOT reject a 'QA Engineer' title that only incidentally mentions IT service desk support in its description", () => {
    const incidentalJob = job({
      jobTitle: "QA Engineer",
      jobDescription:
        "QA Engineer supporting IT service desk software — you will test ticketing workflows, write automated regression suites, and validate release quality for our internal service desk platform.",
      responsibilities: ["Write automated tests for the service desk platform", "Validate ticket routing logic"]
    });
    expect(isHardNegativeRole(incidentalJob)).toBe(false);
  });

  it("does not reject unrelated senior QA/SDET titles", () => {
    expect(isHardNegativeRole(job({ jobTitle: "Principal Software Quality Engineer" }))).toBe(false);
    expect(isHardNegativeRole(job({ jobTitle: "Staff SDET" }))).toBe(false);
    expect(isHardNegativeRole(job({ jobTitle: "AI Quality Engineer" }))).toBe(false);
  });

  it("rejects other hard-negative title variants (Desktop Support, NOC, Network Administrator)", () => {
    expect(isHardNegativeRole(job({ jobTitle: "Desktop Support Technician" }))).toBe(true);
    expect(isHardNegativeRole(job({ jobTitle: "NOC Engineer" }))).toBe(true);
    expect(isHardNegativeRole(job({ jobTitle: "Network Administrator" }))).toBe(true);
  });
});
