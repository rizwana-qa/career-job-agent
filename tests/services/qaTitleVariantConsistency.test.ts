import { describe, expect, it } from "vitest";
import { hasPositiveCareerSignal } from "../../src/services/careerRelevanceFilter.js";
import { classifySearchTier, type SearchTier } from "../../src/services/searchTierClassifier.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";

/**
 * Phase 8.5.14 §10 — cross-system consistency: careerRelevanceFilter.ts and
 * searchTierClassifier.ts must recognize the same real-world QA title
 * families without contradicting each other. Both modules were extended in
 * this phase specifically to close gaps exposed by real Himalayas titles
 * (Phase 8.5.11/8.5.13) — this file verifies neither was updated in
 * isolation.
 */
function job(title: string, overrides: Record<string, unknown> = {}): Job {
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
    skills: ["General"],
    source: "himalayas",
    sourceUrl: "https://himalayas.example/1",
    datePosted: "2026-08-10",
    externalJobId: "1",
    ...overrides
  });
}

describe("Cross-system consistency — careerRelevanceFilter.ts vs searchTierClassifier.ts (Phase 8.5.14 §10)", () => {
  const cases: Array<{ title: string; expectedTier: SearchTier }> = [
    { title: "SQA Engineer", expectedTier: "UNTIERED" }, // no seniority/leadership word — genuine quality family, but no tier
    { title: "Principal SQA Engineer", expectedTier: "TIER_1" },
    { title: "Staff SQA Engineer", expectedTier: "TIER_1" },
    { title: "SQA Lead", expectedTier: "TIER_2" },
    { title: "Senior SQA Engineer", expectedTier: "TIER_3" },
    { title: "Agent Quality / Evals Engineer", expectedTier: "TIER_4" },
    { title: "Agent Quality Engineer", expectedTier: "TIER_4" },
    { title: "LLM Evaluation Engineer", expectedTier: "TIER_4" },
    { title: "AI Evaluation Engineer", expectedTier: "TIER_4" },
    { title: "Model Evaluation Engineer", expectedTier: "TIER_4" }
  ];

  for (const { title, expectedTier } of cases) {
    it(`"${title}" — positive career signal true, search tier = ${expectedTier}`, () => {
      const testJob = job(title);
      expect(hasPositiveCareerSignal(testJob)).toBe(true);
      expect(classifySearchTier(testJob)).toBe(expectedTier);
    });
  }

  it("a QC title only becomes tier-classifiable once it has already cleared the career-relevance contextual check — the two systems agree on the SAME job, not independently", () => {
    const qcWithContext = job("Senior QC Engineer, Software Testing", {
      jobDescription: "Own our software testing and API testing strategy, maintaining our automation framework and CI/CD pipelines."
    });
    expect(hasPositiveCareerSignal(qcWithContext)).toBe(true);
    expect(classifySearchTier(qcWithContext)).toBe("TIER_3");

    const qcWithoutContext = job("Senior QC Engineer", {
      jobDescription: "Join our quality team to inspect and verify product output before shipment.",
      responsibilities: ["Inspect finished goods"],
      requirements: ["Attention to detail"]
    });
    expect(hasPositiveCareerSignal(qcWithoutContext)).toBe(false);
    // classifySearchTier() itself would still title-match TIER_3 in isolation
    // (it's title-only by design) — the real pipeline never reaches this
    // call for qcWithoutContext because buildPreClaudeFilter() checks
    // hasPositiveCareerSignal() first and short-circuits. This asserts the
    // documented design boundary, not a contradiction between the two
    // functions when called independently.
    expect(classifySearchTier(qcWithoutContext)).toBe("TIER_3");
  });
});
