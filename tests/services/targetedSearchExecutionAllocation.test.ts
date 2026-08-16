import { describe, expect, it } from "vitest";
import { orderCandidatesForMatching } from "../../src/services/jobAnalysisService.js";
import { deduplicateAcrossSources } from "../../src/services/jobDeduplicationService.js";
import { isLocationEligible, classifyRemoteEligibility } from "../../src/services/locationEligibilityFilter.js";
import { isHardNegativeRole, hasPositiveCareerSignal, isNonSoftwareQaRole } from "../../src/services/careerRelevanceFilter.js";
import { classifySearchTier } from "../../src/services/searchTierClassifier.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";

/**
 * Phase 8.5.7 §12 regression cases A-C, F-K. These exercise the existing,
 * UNCHANGED downstream pipeline pieces (candidate allocation, cross-source
 * dedup, location eligibility, pre-Claude filters) directly with mock Job
 * data shaped like Himalayas's new multi-query search results — no live
 * Claude/Himalayas/Remote OK calls anywhere in this file. Case D lives in
 * himalayasJobSource.test.ts (query plan/count); Case E lives in
 * remoteOkJobSource.test.ts (single feed fetch).
 */
function job(title: string, id: string, overrides: Record<string, unknown> = {}): Job {
  return JobSchema.parse({
    jobTitle: title,
    company: "Test Co",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: "A sufficiently long job description for schema validation purposes across every test case here.",
    requirements: ["Testing experience"],
    responsibilities: ["Test things"],
    skills: ["Testing"],
    source: "himalayas",
    sourceUrl: `https://himalayas.example/${id}`,
    datePosted: "2026-08-10",
    externalJobId: id,
    ...overrides
  });
}

describe("Phase 8.5.7 §12 — targeted search execution regression cases", () => {
  it("[A] Himalayas returns 5 Tier1 + 10 Tier3 candidates — Tier1 candidates reach the matching budget first", () => {
    const tier1Jobs = Array.from({ length: 5 }, (_, i) => job(`Principal QA Engineer ${i}`, `t1-${i}`));
    const tier3Jobs = Array.from({ length: 10 }, (_, i) => job(`Senior QA Engineer ${i}`, `t3-${i}`));
    const ordered = orderCandidatesForMatching([...tier3Jobs, ...tier1Jobs]);
    const budget = ordered.slice(0, 5);
    expect(budget).toHaveLength(5);
    expect(budget.every((j) => classifySearchTier(j) === "TIER_1")).toBe(true);
  });

  it("[B] 0 Tier1 + 2 Tier2 + 10 Tier3 candidates — Tier2 candidates are prioritized", () => {
    const tier2Jobs = [job("Lead QA Engineer A", "t2-a"), job("Lead QA Engineer B", "t2-b")];
    const tier3Jobs = Array.from({ length: 10 }, (_, i) => job(`Senior QA Engineer ${i}`, `t3-${i}`));
    const ordered = orderCandidatesForMatching([...tier3Jobs, ...tier2Jobs]);
    const budget = ordered.slice(0, 2);
    expect(budget).toHaveLength(2);
    expect(budget.every((j) => classifySearchTier(j) === "TIER_2")).toBe(true);
  });

  it("[C] 1 Tier4 + 20 Tier3 candidates — the Tier4 candidate is available before Tier3 fills the budget", () => {
    const tier4Job = job("AI Quality Engineer", "t4-a");
    const tier3Jobs = Array.from({ length: 20 }, (_, i) => job(`Senior QA Engineer ${i}`, `t3-${i}`));
    const ordered = orderCandidatesForMatching([...tier3Jobs, tier4Job]);
    expect(classifySearchTier(ordered[0])).toBe("TIER_4");
  });

  it("[F] a mixed cross-source pool is deduplicated before the Claude matching budget is applied", () => {
    const himalayasJob = job("Principal QA Engineer", "dup-1", {
      source: "himalayas",
      company: "Acme Corp",
      sourceUrl: "https://himalayas.example/dup-1"
    });
    const remoteOkDuplicate = job("Principal QA Engineer", "dup-1-remoteok", {
      source: "remoteok",
      company: "Acme Corp",
      sourceUrl: "https://remoteok.example/dup-1"
    });
    const distinctJob = job("Staff SDET", "unique-1", { source: "himalayas", company: "Beta Inc" });

    const { deduplicated, duplicatesRemoved } = deduplicateAcrossSources([himalayasJob, remoteOkDuplicate, distinctJob]);
    expect(duplicatesRemoved).toBe(1);
    expect(deduplicated).toHaveLength(2);
  });

  it("[G] with no Tier1/Tier2/Tier4 candidates, Tier3 fills the remaining candidate slots", () => {
    const tier3Jobs = Array.from({ length: 5 }, (_, i) => job(`Senior QA Engineer ${i}`, `t3-${i}`));
    const ordered = orderCandidatesForMatching(tier3Jobs);
    const budget = ordered.slice(0, 3);
    expect(budget).toHaveLength(3);
    expect(budget.every((j) => classifySearchTier(j) === "TIER_3")).toBe(true);
  });

  it("[H] an old but exact-fit Principal role is not rejected by the pre-Claude filters solely because of its age", () => {
    const oldPrincipalJob = job("Principal QA Architect", "old-1", { datePosted: "2020-01-01" });
    expect(isLocationEligible(oldPrincipalJob)).toBe(true);
    expect(isHardNegativeRole(oldPrincipalJob)).toBe(false);
    expect(isNonSoftwareQaRole(oldPrincipalJob)).toBe(false);
    expect(hasPositiveCareerSignal(oldPrincipalJob)).toBe(true);
  });

  it("[I] a Remote US-only listing is excluded by the existing remote eligibility rules", () => {
    const usOnlyJob = job("Senior QA Engineer", "us-only-1", { location: "Remote - US Only", country: "United States" });
    expect(classifyRemoteEligibility(usOnlyJob)).toBe("REMOTE_EXCLUDED");
    expect(isLocationEligible(usOnlyJob)).toBe(false);
  });

  it("[J] a Worldwide remote listing is eligible for further scoring", () => {
    const worldwideJob = job("Senior QA Engineer", "worldwide-1", { location: "Worldwide", country: "Worldwide" });
    expect(classifyRemoteEligibility(worldwideJob)).toBe("REMOTE_PK_ELIGIBLE");
    expect(isLocationEligible(worldwideJob)).toBe(true);
  });

  it("[K] irrelevant roles (Office Assistant, Service Desk, Sales, Data Entry, Manufacturing QA) never reach Claude", () => {
    const officeAssistant = job("Remote Office Assistant", "k-1", {
      jobDescription: "Support daily office operations and manage calendars for a distributed team.",
      skills: ["Scheduling"],
      responsibilities: ["Manage calendars"]
    });
    const serviceDesk = job("Tier III Service Desk Engineer", "k-2");
    const salesRep = job("Sales Development Representative", "k-3", {
      jobDescription: "Generate pipeline and close new business for our SaaS product across target accounts.",
      skills: ["Sales"],
      responsibilities: ["Prospecting"]
    });
    const dataEntry = job("Remote Data Entry Clerk", "k-4", {
      jobDescription: "Enter records accurately into our internal database systems every business day.",
      skills: ["Typing"],
      responsibilities: ["Data entry"]
    });
    const manufacturingQa = job("Manufacturing QA Technician", "k-5");

    expect(hasPositiveCareerSignal(officeAssistant)).toBe(false);
    expect(isHardNegativeRole(serviceDesk)).toBe(true);
    expect(hasPositiveCareerSignal(salesRep)).toBe(false);
    expect(hasPositiveCareerSignal(dataEntry)).toBe(false);
    expect(isNonSoftwareQaRole(manufacturingQa)).toBe(true);
  });
});
