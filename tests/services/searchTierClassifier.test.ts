import { describe, expect, it } from "vitest";
import { classifySearchTier, SEARCH_TIER_PRIORITY_ORDER } from "../../src/services/searchTierClassifier.js";
import { isHardNegativeRole, hasPositiveCareerSignal, isNonSoftwareQaRole } from "../../src/services/careerRelevanceFilter.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";

function job(title: string, overrides: Record<string, unknown> = {}): Job {
  return JobSchema.parse({
    jobTitle: title,
    company: "Test Co",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: "A sufficiently long job description for schema validation purposes.",
    requirements: ["Testing experience"],
    responsibilities: ["Test things"],
    skills: ["Testing"],
    source: "himalayas",
    sourceUrl: "https://himalayas.example/1",
    datePosted: "2026-08-10",
    externalJobId: "1",
    ...overrides
  });
}

/** Phase 8.5.6 §13 — cases A-J. */
describe("classifySearchTier — regression cases A-E (Phase 8.5.6 §13)", () => {
  it("[A] Principal QA Architect classifies as TIER_1", () => {
    expect(classifySearchTier(job("Principal QA Architect"))).toBe("TIER_1");
  });

  it("[B] Staff SDET classifies as TIER_1", () => {
    expect(classifySearchTier(job("Staff SDET"))).toBe("TIER_1");
  });

  it("[C] Lead QA Engineer classifies as TIER_2", () => {
    expect(classifySearchTier(job("Lead QA Engineer"))).toBe("TIER_2");
  });

  it("[D] Senior QA Engineer (even with strong automation architecture in the description) classifies as TIER_3 — searchTier is title-only, distinct from strategicRanking's scope score", () => {
    const strongScopeSenior = job("Senior QA Engineer", {
      jobDescription: "Own automation architecture and test architecture for the platform.",
      responsibilities: ["Own automation architecture"]
    });
    expect(classifySearchTier(strongScopeSenior)).toBe("TIER_3");
  });

  it("[E] AI Quality Engineer classifies as TIER_4", () => {
    expect(classifySearchTier(job("AI Quality Engineer"))).toBe("TIER_4");
  });

  it("[F] Senior QA Engineer with manual-execution-only content still classifies as TIER_3 (search tier), even though it will score lower in strategic ranking separately", () => {
    const manualSenior = job("Senior QA Engineer", {
      jobDescription: "Execute defined tasks and manual testing under guidance, following predefined test cases.",
      responsibilities: ["Perform manual testing"]
    });
    expect(classifySearchTier(manualSenior)).toBe("TIER_3");
  });

  it("AI takes precedence over a seniority word when both are present (e.g. 'AI Quality Assurance Lead' is TIER_4, not TIER_2)", () => {
    expect(classifySearchTier(job("AI Quality Assurance Lead"))).toBe("TIER_4");
  });

  it("a title with no tier signal at all classifies as UNTIERED", () => {
    expect(classifySearchTier(job("QA Engineer"))).toBe("UNTIERED");
  });
});

/** Phase 8.5.6 §13 — cases G-J: these never reach searchTier classification in the real pipeline because the unchanged pre-Claude filters reject them first. */
describe("Search tier cases G-J — rejected before reaching Claude or searchTier classification (Phase 8.5.6 §13)", () => {
  it("[G] Office Assistant is rejected by the positive career-signal prefilter", () => {
    const officeAssistant = job("Remote Office Assistant", {
      jobDescription: "Support daily office operations and administrative tasks for a small distributed team.",
      skills: ["Scheduling"],
      responsibilities: ["Manage calendars"]
    });
    expect(hasPositiveCareerSignal(officeAssistant)).toBe(false);
  });

  it("[H] Service Desk Engineer is rejected by the hard negative filter", () => {
    expect(isHardNegativeRole(job("Tier III Service Desk Engineer"))).toBe(true);
  });

  it("[I] Manufacturing QA is rejected by the non-software-QA filter", () => {
    expect(isNonSoftwareQaRole(job("Manufacturing QA Technician"))).toBe(true);
  });

  it("[J] AI Data Annotator is rejected by the non-software-QA filter", () => {
    expect(isNonSoftwareQaRole(job("AI Data Annotator"))).toBe(true);
  });
});

describe("SEARCH_TIER_PRIORITY_ORDER", () => {
  it("is Tier 1 -> Tier 2 -> Tier 4 -> Tier 3 -> UNTIERED (Phase 8.5.6 §3) — NOT Tier 1 -> 2 -> 3 -> 4", () => {
    expect(SEARCH_TIER_PRIORITY_ORDER).toEqual(["TIER_1", "TIER_2", "TIER_4", "TIER_3", "UNTIERED"]);
  });
});
