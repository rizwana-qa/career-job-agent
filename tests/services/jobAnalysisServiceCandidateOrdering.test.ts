import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { analyzeJobs, orderCandidatesForMatching } from "../../src/services/jobAnalysisService.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";

const profile = {
  professionalTitle: "Principal Software Quality Engineer",
  coreSkills: "Playwright, API Testing, SQL"
};

function job(source: string, id: string, title: string, overrides: Record<string, unknown> = {}): Job {
  return JobSchema.parse({
    jobTitle: title,
    company: "Test Co",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: "A sufficiently long job description mentioning quality engineering and testing responsibilities.",
    requirements: ["Testing experience"],
    responsibilities: ["Test the product"],
    skills: ["Testing", "QA"],
    source,
    sourceUrl: `https://${source}.example/${id}`,
    datePosted: "2026-08-10",
    externalJobId: id,
    ...overrides
  });
}

/** Synthetic pre-Claude filter for these tests — a real careerRelevanceFilter.ts is already covered elsewhere; this isolates jobAnalysisService's ordering/capping logic. */
function qualifiesIf(predicate: (job: Job) => boolean): (job: Job) => boolean {
  return predicate;
}

function alwaysSucceedingClient(): Anthropic {
  const create = vi.fn(async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          matchScore: 80,
          interviewPotential: 70,
          careerGrowth: 60,
          futureAIValue: 55,
          recommendation: "APPLY",
          strongMatches: [],
          transferableSkills: [],
          gaps: [],
          risks: [],
          reason: "test fixture reason"
        })
      }
    ]
  }));
  return { messages: { create } } as unknown as Anthropic;
}

/**
 * Phase 8.5.2 regression suite — reproduces the production report (53
 * candidates, maxJobs=3, 0 sent to Claude because maxJobs capped the RAW
 * list before the pre-Claude filter ran) and confirms the fix: the filter
 * now runs first, and maxJobs caps the QUALIFYING set.
 */
describe("analyzeJobs — candidate selection ordering (Phase 8.5.2)", () => {
  it("CASE A: 53 candidates, first 3 fail the pre-Claude filter, the rest qualify, maxJobs=3 — sends exactly 3 to Claude, never 0", async () => {
    const rawJobs = [
      ...Array.from({ length: 3 }, (_, i) => job("himalayas", `reject-${i}`, `Reject ${i}`)),
      ...Array.from({ length: 50 }, (_, i) => job("himalayas", `qualify-${i}`, `Qualify ${i}`))
    ];
    const preMatchFilter = qualifiesIf((j) => j.jobTitle.startsWith("Qualify"));
    const client = alwaysSucceedingClient();

    const result = await analyzeJobs(rawJobs, { claudeClient: client, profile, maxJobs: 3, preMatchFilter });

    expect(result.relevanceFilteredCount).toBeGreaterThanOrEqual(3);
    expect(result.jobsSentToMatching).toBe(3);
    expect(client.messages.create).toHaveBeenCalledTimes(3);
    // Never rejects a request as "no client configured" just because maxJobs=3 landed on the wrong candidates.
    expect(result.jobsAnalyzed).toBe(3);
  });

  it("CASE B: 53 candidates, only 2 qualify — sends exactly 2 to Claude, not padded to maxJobs", async () => {
    const rawJobs = [
      ...Array.from({ length: 2 }, (_, i) => job("himalayas", `qualify-${i}`, `Qualify ${i}`)),
      ...Array.from({ length: 51 }, (_, i) => job("himalayas", `reject-${i}`, `Reject ${i}`))
    ];
    const preMatchFilter = qualifiesIf((j) => j.jobTitle.startsWith("Qualify"));
    const client = alwaysSucceedingClient();

    const result = await analyzeJobs(rawJobs, { claudeClient: client, profile, maxJobs: 3, preMatchFilter });

    expect(result.jobsSentToMatching).toBe(2);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("CASE C: 53 candidates, zero qualify — sends 0 to Claude, and never throws ClaudeNotConfiguredError even with no client", async () => {
    const rawJobs = Array.from({ length: 53 }, (_, i) => job("himalayas", `reject-${i}`, `Reject ${i}`));
    const preMatchFilter = qualifiesIf(() => false);

    const result = await analyzeJobs(rawJobs, { profile, maxJobs: 3, preMatchFilter }); // no claudeClient at all

    expect(result.jobsSentToMatching).toBe(0);
    expect(result.jobsAnalyzed).toBe(0);
    expect(result.topJobs).toEqual([]);
  });

  it("CASE E: no qualifying candidate until after the first 10 records — the system keeps scanning instead of stopping at maxJobs raw records", async () => {
    const rawJobs = [
      ...Array.from({ length: 10 }, (_, i) => job("himalayas", `reject-${i}`, `Reject ${i}`)),
      ...Array.from({ length: 10 }, (_, i) => job("himalayas", `qualify-${i}`, `Qualify ${i}`))
    ];
    const preMatchFilter = qualifiesIf((j) => j.jobTitle.startsWith("Qualify"));
    const client = alwaysSucceedingClient();

    const result = await analyzeJobs(rawJobs, { claudeClient: client, profile, maxJobs: 3, preMatchFilter });

    // If maxJobs had capped the RAW list first (the pre-8.5.2 bug), all 3
    // taken would be from the first 10 "Reject" records, and 0 would reach
    // Claude. The fix must scan past them and find the qualifying ones.
    expect(result.jobsSentToMatching).toBe(3);
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  it("does not change behavior at all when no preMatchFilter is supplied (/career/run, /jobs/analyze untouched)", async () => {
    const rawJobs = Array.from({ length: 10 }, (_, i) => job("remotive", `job-${i}`, `Quality Engineer ${i}`));
    const client = alwaysSucceedingClient();

    const result = await analyzeJobs(rawJobs, { claudeClient: client, profile, maxJobs: 3 });

    // No preMatchFilter -> the legacy behavior applies: maxJobs caps the
    // eligible list directly, in original order, no relevanceFilteredCount/
    // jobsSentToMatching fields at all.
    expect(result.relevanceFilteredCount).toBeUndefined();
    expect(result.jobsSentToMatching).toBeUndefined();
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });
});

/** CASE D: source mixing (Phase 8.5.2 §6) — Himalayas=20, Remote OK=101, verified directly against the ordering function used inside analyzeJobs(). */
describe("orderCandidatesForMatching — source mixing (Phase 8.5.2 §6)", () => {
  it("interleaves sources round-robin instead of exhausting the larger source first", () => {
    const himalayasJobs = Array.from({ length: 20 }, (_, i) => job("himalayas", `h-${i}`, `QA Engineer H${i}`));
    const remoteOkJobs = Array.from({ length: 101 }, (_, i) => job("remoteok", `r-${i}`, `QA Engineer R${i}`));

    const ordered = orderCandidatesForMatching([...himalayasJobs, ...remoteOkJobs]);

    expect(ordered).toHaveLength(121);
    // The first few candidates must include BOTH sources, not 3 Remote OK
    // records purely because Remote OK's jobs happened to be listed/pushed
    // first in raw discovery order.
    const firstThreeSources = new Set(ordered.slice(0, 3).map((j) => j.source));
    expect(firstThreeSources.size).toBeGreaterThan(1);
    expect(ordered.slice(0, 3).some((j) => j.source === "himalayas")).toBe(true);
  });

  it("caps to maxJobs=3 with candidates from more than one source when both sources have qualifying jobs", async () => {
    const himalayasJobs = Array.from({ length: 20 }, (_, i) => job("himalayas", `h-${i}`, `QA Engineer H${i}`));
    const remoteOkJobs = Array.from({ length: 101 }, (_, i) => job("remoteok", `r-${i}`, `QA Engineer R${i}`));
    const client = alwaysSucceedingClient();

    const result = await analyzeJobs([...himalayasJobs, ...remoteOkJobs], {
      claudeClient: client,
      profile,
      maxJobs: 3,
      includeRankedJobs: true,
      preMatchFilter: () => true // everything qualifies — isolates the source-mixing concern specifically
    });

    expect(result.jobsSentToMatching).toBe(3);
    const sourcesUsed = new Set((result.rankedJobs ?? []).map((r) => r.job.source));
    expect(sourcesUsed.size).toBeGreaterThan(1);
  });

  it("preserves relative order within a single source (stable, deterministic — no Claude involvement)", () => {
    const onlyHimalayas = Array.from({ length: 5 }, (_, i) => job("himalayas", `h-${i}`, `QA Engineer H${i}`));
    const ordered = orderCandidatesForMatching(onlyHimalayas);
    expect(ordered.map((j) => j.externalJobId)).toEqual(["h-0", "h-1", "h-2", "h-3", "h-4"]);
  });
});

/** Phase 8.5.6 §13 — cases K and L: search-tier candidate allocation. */
describe("orderCandidatesForMatching — search-tier allocation (Phase 8.5.6 §8-9, cases K-L)", () => {
  it("[K] with maxJobs=3 and all tiers available, the selected candidates are not three generic Tier 3 jobs", () => {
    const tier3Jobs = Array.from({ length: 10 }, (_, i) => job("himalayas", `senior-${i}`, `Senior QA Engineer ${i}`));
    const tier1Jobs = [job("himalayas", "principal-0", "Principal QA Architect"), job("himalayas", "principal-1", "Staff SDET")];
    const tier2Jobs = [job("himalayas", "lead-0", "Lead QA Engineer"), job("himalayas", "lead-1", "Quality Engineering Lead")];
    const tier4Jobs = [job("himalayas", "ai-0", "AI Quality Engineer"), job("himalayas", "ai-1", "AI Test Engineer")];

    // Deliberately listed with Tier 3 first in raw order, to prove
    // allocation is driven by tier priority, not discovery order.
    const ordered = orderCandidatesForMatching([...tier3Jobs, ...tier1Jobs, ...tier2Jobs, ...tier4Jobs]);
    const firstThree = ordered.slice(0, 3);

    const allGenericSenior = firstThree.every((j) => j.jobTitle.startsWith("Senior QA Engineer"));
    expect(allGenericSenior).toBe(false);
    // With 2 Tier 1 candidates available, both should be among the first 3.
    expect(firstThree.filter((j) => j.externalJobId.startsWith("principal")).length).toBe(2);
  });

  it("[K] end to end via analyzeJobs: jobsSentToMatching for maxJobs=3 includes at least one non-Tier-3 candidate when higher tiers exist", async () => {
    const tier3Jobs = Array.from({ length: 10 }, (_, i) => job("himalayas", `senior-${i}`, `Senior QA Engineer ${i}`));
    const tier1Jobs = [job("himalayas", "principal-0", "Principal QA Architect")];
    const tier4Jobs = [job("himalayas", "ai-0", "AI Quality Engineer")];
    const client = alwaysSucceedingClient();

    const result = await analyzeJobs([...tier3Jobs, ...tier1Jobs, ...tier4Jobs], {
      claudeClient: client,
      profile,
      maxJobs: 3,
      includeRankedJobs: true,
      preMatchFilter: () => true
    });

    expect(result.jobsSentToMatching).toBe(3);
    const titlesSent = (result.rankedJobs ?? []).map((r) => r.job.jobTitle);
    expect(titlesSent).toContain("Principal QA Architect");
    expect(titlesSent).toContain("AI Quality Engineer");
  });

  it("[L] when Tier 1 is empty, Tier 2 / Tier 4 / Tier 3 fill the available capacity without any gap or failure", () => {
    const tier3Jobs = Array.from({ length: 10 }, (_, i) => job("himalayas", `senior-${i}`, `Senior QA Engineer ${i}`));
    const tier2Jobs = [job("himalayas", "lead-0", "Lead QA Engineer"), job("himalayas", "lead-1", "Quality Engineering Lead")];
    const tier4Jobs = [job("himalayas", "ai-0", "AI Quality Engineer")];
    // No Tier 1 jobs at all.

    const ordered = orderCandidatesForMatching([...tier3Jobs, ...tier2Jobs, ...tier4Jobs]);
    const firstThree = ordered.slice(0, 3);

    expect(firstThree).toHaveLength(3);
    // Both Tier 2 candidates and the Tier 4 candidate fill the top slots ahead of Tier 3.
    expect(firstThree.filter((j) => j.externalJobId.startsWith("lead")).length).toBe(2);
    expect(firstThree.some((j) => j.externalJobId === "ai-0")).toBe(true);
    expect(firstThree.some((j) => j.jobTitle.startsWith("Senior QA Engineer"))).toBe(false);
  });
});
