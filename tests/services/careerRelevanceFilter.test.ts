import { describe, expect, it } from "vitest";
import { isHardNegativeRole, hasPositiveCareerSignal, evaluateCareerSignal } from "../../src/services/careerRelevanceFilter.js";
import { isLocationEligible } from "../../src/services/locationEligibilityFilter.js";
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

/** Positive pre-Claude career relevance prefilter (Phase 8.3.3 §7) — cases A-J. */
describe("hasPositiveCareerSignal / evaluateCareerSignal — positive pre-Claude prefilter", () => {
  const genericNonQaDescription =
    "Join our team to support day-to-day operations, coordinate with stakeholders, and keep things running smoothly for the business.";

  it("[A] rejects 'Remote Office Assistant' — clearly unrelated title, no positive signals", () => {
    const result = evaluateCareerSignal(
      job({ jobTitle: "Remote Office Assistant", jobDescription: genericNonQaDescription, skills: ["Scheduling"], responsibilities: ["Manage calendars"], requirements: ["Organizational skills"] })
    );
    expect(result.passes).toBe(false);
    expect(result.strength).toBe("NONE");
  });

  it("[B] rejects 'Face Deduplication Collection' — clearly unrelated title, no positive signals", () => {
    const result = evaluateCareerSignal(
      job({ jobTitle: "Face Deduplication Collection", jobDescription: "Help collect and label facial image data for a research dataset.", skills: ["Data collection"], responsibilities: ["Collect images"], requirements: ["Attention to detail"] })
    );
    expect(result.passes).toBe(false);
    expect(result.strength).toBe("NONE");
  });

  it("[C] rejects 'Tier III Service Desk Engineer' — also caught by the hard negative filter, and independently has no positive signal", () => {
    const serviceDeskJob = job({
      jobTitle: "Tier III Service Desk Engineer",
      jobDescription: "Provide advanced troubleshooting and escalation support for end-user IT tickets across the organization.",
      skills: ["Ticketing", "Windows Support"],
      responsibilities: ["Resolve escalated support tickets"],
      requirements: ["ITIL experience"]
    });
    expect(isHardNegativeRole(serviceDeskJob)).toBe(true);
    expect(hasPositiveCareerSignal(serviceDeskJob)).toBe(false);
  });

  it("[D] admits 'Senior QA Engineer' on title alone", () => {
    const result = evaluateCareerSignal(job({ jobTitle: "Senior QA Engineer" }));
    expect(result.passes).toBe(true);
    expect(result.strength).toBe("STRONG_TITLE");
  });

  it("[E] admits 'Principal Software Quality Engineer' on title alone", () => {
    const result = evaluateCareerSignal(job({ jobTitle: "Principal Software Quality Engineer" }));
    expect(result.passes).toBe(true);
    expect(result.strength).toBe("STRONG_TITLE");
  });

  it("[F] admits 'AI Quality Engineer' on title alone", () => {
    const result = evaluateCareerSignal(job({ jobTitle: "AI Quality Engineer" }));
    expect(result.passes).toBe(true);
    expect(result.strength).toBe("STRONG_TITLE");
  });

  it("[G] admits 'SDET' on title alone", () => {
    const result = evaluateCareerSignal(job({ jobTitle: "SDET" }));
    expect(result.passes).toBe(true);
    expect(result.strength).toBe("STRONG_TITLE");
  });

  it("[H] admits 'Automation Engineer' with a strong testing description", () => {
    const result = evaluateCareerSignal(
      job({
        jobTitle: "Automation Engineer",
        jobDescription: "Build and maintain our Playwright-based test automation framework, covering API testing and CI/CD testing pipelines.",
        skills: ["Playwright", "API Testing"],
        responsibilities: ["Maintain the automation framework"],
        requirements: ["CI/CD experience"]
      })
    );
    expect(result.passes).toBe(true); // title alone already qualifies (Automation Engineer is a strong-title pattern)
  });

  it("[I] 'Software Engineer' with no testing signals does not automatically qualify as a strong match, but is not pre-Claude-rejected either", () => {
    const result = evaluateCareerSignal(
      job({ jobTitle: "Software Engineer", jobDescription: genericNonQaDescription, skills: ["JavaScript"], responsibilities: ["Build features"], requirements: ["3+ years experience"] })
    );
    expect(result.passes).toBe(true);
    expect(result.strength).toBe("AMBIGUOUS_TITLE"); // not a confirmed QA match — deferred to Claude, per Phase 8.3.3 §4
    expect(result.strength).not.toBe("STRONG_TITLE");
  });

  it("[J] a 'QA Engineer' title with an incidental 'service desk' mention is not rejected by either pre-Claude filter, and reaches Claude", () => {
    const incidentalJob = job({
      jobTitle: "QA Engineer",
      jobDescription:
        "QA Engineer supporting IT service desk software — you will test ticketing workflows, write automated regression suites, and validate release quality for our internal service desk platform.",
      responsibilities: ["Write automated tests for the service desk platform", "Validate ticket routing logic"]
    });
    expect(isHardNegativeRole(incidentalJob)).toBe(false);
    expect(hasPositiveCareerSignal(incidentalJob)).toBe(true);
    expect(isLocationEligible(incidentalJob)).toBe(true); // REMOTE by default in the job() fixture
  });

  it("requires a combination of secondary signals, not a single incidental keyword, for an unrelated-titled job", () => {
    const singleSignalOnly = job({
      jobTitle: "Operations Coordinator",
      jobDescription: "Coordinate operations across teams. Occasionally reviews API testing tickets submitted by engineering.",
      skills: ["Coordination"],
      responsibilities: ["Coordinate schedules"],
      requirements: ["Organizational skills"]
    });
    expect(hasPositiveCareerSignal(singleSignalOnly)).toBe(false); // only 1 secondary signal ("API Testing") — below the minimum

    const twoSignals = job({
      jobTitle: "Operations Coordinator",
      jobDescription: "Coordinate operations across teams, reviewing API testing tickets and maintaining our automation framework documentation.",
      skills: ["Coordination"],
      responsibilities: ["Coordinate schedules"],
      requirements: ["Organizational skills"]
    });
    expect(hasPositiveCareerSignal(twoSignals)).toBe(true); // "API Testing" + "Automation Framework" — a reasonable combination
  });
});
