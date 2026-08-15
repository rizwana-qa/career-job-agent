import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { analyzeJobs } from "../../src/services/jobAnalysisService.js";
import { loadJobFixture } from "../helpers/fixtures.js";

const profile = {
  professionalTitle: "Principal Software Quality Engineer",
  coreSkills: "Playwright, API Testing, SQL"
};

function validMatchJson(): string {
  return JSON.stringify({
    matchScore: 75,
    interviewPotential: 60,
    careerGrowth: 55,
    futureAIValue: 65,
    recommendation: "CONSIDER",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason"
  });
}

function mockClient(outcomes: Array<"ok" | "fail">): Anthropic {
  let call = 0;
  const create = vi.fn(async () => {
    const outcome = outcomes[call] ?? "ok";
    call += 1;
    if (outcome === "fail") {
      const error = new Error("Unauthorized") as Error & { status: number };
      error.status = 401; // non-retryable, so call counts stay predictable
      throw error;
    }
    return { content: [{ type: "text", text: validMatchJson() }] };
  });
  return { messages: { create } } as unknown as Anthropic;
}

describe("jobAnalysisService.analyzeJobs", () => {
  it("returns a clean empty result for an empty job list without calling Claude", async () => {
    const client = mockClient([]);
    const result = await analyzeJobs([], { claudeClient: client, profile });

    expect(result).toEqual({ jobsReceived: 0, jobsEligible: 0, jobsAnalyzed: 0, topJobs: [] });
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("does not require a Claude client at all when the job list is empty", async () => {
    const result = await analyzeJobs([], { profile });
    expect(result).toEqual({ jobsReceived: 0, jobsEligible: 0, jobsAnalyzed: 0, topJobs: [] });
  });

  it("does not require a Claude client when every job is filtered out deterministically", async () => {
    const rawJobs = [loadJobFixture("10-unrelated-low-match.json")];
    const result = await analyzeJobs(rawJobs, { profile });
    expect(result.jobsEligible).toBe(0);
    expect(result.topJobs).toEqual([]);
  });

  it("throws ClaudeNotConfiguredError when an eligible job needs matching but no client is available", async () => {
    const rawJobs = [loadJobFixture("01-principal-qa-engineer.json")];
    await expect(analyzeJobs(rawJobs, { profile })).rejects.toThrow("Claude API is not configured");
  });

  it("runs the full pipeline for a mix of valid, filtered-out, and matched jobs", async () => {
    const rawJobs = [
      loadJobFixture("01-principal-qa-engineer.json"),
      loadJobFixture("02-staff-qa-engineer.json"),
      loadJobFixture("10-unrelated-low-match.json") // filtered out deterministically, never reaches Claude
    ];
    const client = mockClient(["ok", "ok"]);

    const result = await analyzeJobs(rawJobs, { claudeClient: client, profile });

    expect(result.jobsReceived).toBe(3);
    expect(result.jobsEligible).toBe(2);
    expect(result.jobsAnalyzed).toBe(2);
    expect(result.topJobs).toHaveLength(2);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result.topJobs[0].matchScoreLabel).toBe("Estimated Application Match Score");
  });

  it("records per-job Claude failures without aborting the rest of the batch", async () => {
    const rawJobs = [
      loadJobFixture("01-principal-qa-engineer.json"),
      loadJobFixture("02-staff-qa-engineer.json")
    ];
    const client = mockClient(["fail", "ok"]);

    const result = await analyzeJobs(rawJobs, { claudeClient: client, profile });

    expect(result.jobsEligible).toBe(2);
    expect(result.jobsAnalyzed).toBe(1);
    expect(result.topJobs).toHaveLength(1);
    expect(result.claudeFailures).toHaveLength(1);
    expect(result.claudeFailures?.[0].company).toBe("Meridian Fintech");
  });

  it("reports invalid raw jobs separately from eligible/analyzed counts", async () => {
    const rawJobs = [loadJobFixture("01-principal-qa-engineer.json"), { jobTitle: "Broken" }];
    const client = mockClient(["ok"]);

    const result = await analyzeJobs(rawJobs, { claudeClient: client, profile });

    expect(result.jobsReceived).toBe(2);
    expect(result.invalidJobs).toHaveLength(1);
    expect(result.jobsEligible).toBe(1);
    expect(result.jobsAnalyzed).toBe(1);
  });

  it("returns no top jobs when every job is filtered out deterministically", async () => {
    const rawJobs = [loadJobFixture("10-unrelated-low-match.json")];
    const client = mockClient([]);

    const result = await analyzeJobs(rawJobs, { claudeClient: client, profile });

    expect(result.jobsEligible).toBe(0);
    expect(result.jobsAnalyzed).toBe(0);
    expect(result.topJobs).toEqual([]);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("reports salary as the literal string UNKNOWN when a job doesn't disclose one, never a fabricated number", async () => {
    const rawJobs = [loadJobFixture("03-qa-architect.json")]; // no salary field in this fixture
    const client = mockClient(["ok"]);

    const result = await analyzeJobs(rawJobs, { claudeClient: client, profile });

    expect(result.topJobs[0].salary).toBe("UNKNOWN");
    expect(result.topJobs[0].currency).toBe("UNKNOWN");
    expect(result.topJobs[0].salaryDataAvailable).toBe(false);
    expect(result.topJobs[0].salaryPotential).toBeNull();
  });

  it("reports the job's own disclosed salary figure as-is when present", async () => {
    const rawJobs = [loadJobFixture("01-principal-qa-engineer.json")]; // salary: 195000, currency: USD
    const client = mockClient(["ok"]);

    const result = await analyzeJobs(rawJobs, { claudeClient: client, profile });

    expect(result.topJobs[0].salary).toBe(195000);
    expect(result.topJobs[0].currency).toBe("USD");
  });

  it("does not compute salaryPotential from a disclosed salary unless a referenceSalary is also supplied", async () => {
    const rawJobs = [loadJobFixture("01-principal-qa-engineer.json")];
    const client = mockClient(["ok"]);

    const result = await analyzeJobs(rawJobs, { claudeClient: client, profile });

    expect(result.topJobs[0].salaryDataAvailable).toBe(false);
    expect(result.topJobs[0].salaryPotential).toBeNull();
  });

  it("computes salaryPotential only when both a disclosed salary and a caller referenceSalary exist", async () => {
    const rawJobs = [loadJobFixture("01-principal-qa-engineer.json")]; // salary: 195000
    const client = mockClient(["ok"]);

    const result = await analyzeJobs(rawJobs, {
      claudeClient: client,
      profile,
      rankingOptions: { referenceSalary: 195000 }
    });

    expect(result.topJobs[0].salaryDataAvailable).toBe(true);
    expect(result.topJobs[0].salaryPotential).toBe(100);
  });

  it("caps topJobs at the requested topCount", async () => {
    const rawJobs = [
      loadJobFixture("01-principal-qa-engineer.json"),
      loadJobFixture("02-staff-qa-engineer.json"),
      loadJobFixture("03-qa-architect.json")
    ];
    const client = mockClient(["ok", "ok", "ok"]);

    const result = await analyzeJobs(rawJobs, { claudeClient: client, profile, topCount: 2 });
    expect(result.topJobs).toHaveLength(2);
  });
});
