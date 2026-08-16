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

/** Phase 8.5.9 §9 — regression cases A-P: TIER_1/2/3 now require a genuine quality-family title signal in addition to seniority/leadership; TIER_4 requires genuine AI-quality/testing phrasing, not a bare "AI"/"Agent" mention. */
describe("classifySearchTier — Phase 8.5.9 §9 regression cases A-P", () => {
  it("[A] Principal QA Engineer -> TIER_1", () => {
    expect(classifySearchTier(job("Principal QA Engineer"))).toBe("TIER_1");
  });

  it("[B] Staff Software Quality Engineer -> TIER_1", () => {
    expect(classifySearchTier(job("Staff Software Quality Engineer"))).toBe("TIER_1");
  });

  it("[C] QA Architect -> TIER_1", () => {
    expect(classifySearchTier(job("QA Architect"))).toBe("TIER_1");
  });

  it("[D] Automation Architect -> TIER_1", () => {
    expect(classifySearchTier(job("Automation Architect"))).toBe("TIER_1");
  });

  it("[E] Principal Software Engineer -> NOT TIER_1 (no genuine quality/testing title signal)", () => {
    expect(classifySearchTier(job("Principal Software Engineer"))).not.toBe("TIER_1");
    expect(classifySearchTier(job("Principal Software Engineer"))).toBe("UNTIERED");
  });

  it("[F] Staff Backend Engineer -> NOT TIER_1", () => {
    expect(classifySearchTier(job("Staff Backend Engineer"))).not.toBe("TIER_1");
    expect(classifySearchTier(job("Staff Backend Engineer"))).toBe("UNTIERED");
  });

  it("[G] Lead QA Engineer -> TIER_2", () => {
    expect(classifySearchTier(job("Lead QA Engineer"))).toBe("TIER_2");
  });

  it("[H] SDET Lead -> TIER_2", () => {
    expect(classifySearchTier(job("SDET Lead"))).toBe("TIER_2");
  });

  it("[I] Technical Lead -> NOT TIER_2 (no genuine quality/testing title signal)", () => {
    expect(classifySearchTier(job("Technical Lead"))).not.toBe("TIER_2");
    expect(classifySearchTier(job("Technical Lead"))).toBe("UNTIERED");
  });

  it("[J] AI Quality Engineer -> TIER_4", () => {
    expect(classifySearchTier(job("AI Quality Engineer"))).toBe("TIER_4");
  });

  it("[K] LLM Evaluation Engineer -> TIER_4", () => {
    expect(classifySearchTier(job("LLM Evaluation Engineer"))).toBe("TIER_4");
  });

  it("[L] AI Engineer -> NOT TIER_4 automatically (generic AI engineering, no testing/evaluation/quality signal)", () => {
    expect(classifySearchTier(job("AI Engineer"))).not.toBe("TIER_4");
    expect(classifySearchTier(job("AI Engineer"))).toBe("UNTIERED");
  });

  it("[M] Senior QA Engineer -> TIER_3", () => {
    expect(classifySearchTier(job("Senior QA Engineer"))).toBe("TIER_3");
  });

  it("[N] Senior Data Engineer -> NOT TIER_3", () => {
    expect(classifySearchTier(job("Senior Data Engineer"))).not.toBe("TIER_3");
    expect(classifySearchTier(job("Senior Data Engineer"))).toBe("UNTIERED");
  });

  it("[O] Generic Software Engineer -> UNTIERED, never automatically a high tier", () => {
    expect(classifySearchTier(job("Software Engineer"))).toBe("UNTIERED");
  });

  it("[P] Principal Product Engineer -> NOT TIER_1", () => {
    expect(classifySearchTier(job("Principal Product Engineer"))).not.toBe("TIER_1");
    expect(classifySearchTier(job("Principal Product Engineer"))).toBe("UNTIERED");
  });

  it("generic AI-adjacent titles (Researcher, Data Scientist) are not force-fit into Tier 4", () => {
    expect(classifySearchTier(job("AI Researcher"))).toBe("UNTIERED");
    expect(classifySearchTier(job("Machine Learning Engineer"))).toBe("UNTIERED");
    expect(classifySearchTier(job("Data Scientist"))).toBe("UNTIERED");
  });
});

/** Phase 8.5.14 §6/§9 — SQA/QC/AI-eval title-family alignment with careerRelevanceFilter.ts. */
describe("classifySearchTier — real-world QA title variants (Phase 8.5.14)", () => {
  it("Principal SQA Engineer -> TIER_1", () => {
    expect(classifySearchTier(job("Principal SQA Engineer"))).toBe("TIER_1");
  });

  it("Staff SQA Engineer -> TIER_1", () => {
    expect(classifySearchTier(job("Staff SQA Engineer"))).toBe("TIER_1");
  });

  it("SQA Lead -> TIER_2", () => {
    expect(classifySearchTier(job("SQA Lead"))).toBe("TIER_2");
  });

  it("[E] Senior principal QA Engineer -> TIER_1 (Principal takes priority over Senior)", () => {
    expect(classifySearchTier(job("Senior principal QA Engineer"))).toBe("TIER_1");
  });

  it("Senior SQA Engineer -> TIER_3", () => {
    expect(classifySearchTier(job("Senior SQA Engineer"))).toBe("TIER_3");
  });

  it("[G] Agent Quality Engineer -> TIER_4", () => {
    expect(classifySearchTier(job("Agent Quality Engineer"))).toBe("TIER_4");
  });

  it("Agent Quality / Evals Engineer -> TIER_4", () => {
    expect(classifySearchTier(job("Agent Quality / Evals Engineer"))).toBe("TIER_4");
  });

  it("[H] LLM Evaluation Engineer -> TIER_4", () => {
    expect(classifySearchTier(job("LLM Evaluation Engineer"))).toBe("TIER_4");
  });

  it("Senior QC Engineer -> TIER_3 (title-only; only ever reached after careerRelevanceFilter.ts already confirmed software-testing context)", () => {
    // classifySearchTier() is title-only by design and only ever runs on
    // jobs that already passed hasPositiveCareerSignal() — for a bare "QC"
    // title, that means its description already carried the required
    // software-testing evidence (see careerRelevanceFilter.test.ts [D]).
    expect(classifySearchTier(job("Senior QC Engineer"))).toBe("TIER_3");
  });
});

describe("SEARCH_TIER_PRIORITY_ORDER", () => {
  it("is Tier 1 -> Tier 2 -> Tier 4 -> Tier 3 -> UNTIERED (Phase 8.5.6 §3) — NOT Tier 1 -> 2 -> 3 -> 4", () => {
    expect(SEARCH_TIER_PRIORITY_ORDER).toEqual(["TIER_1", "TIER_2", "TIER_4", "TIER_3", "UNTIERED"]);
  });
});
