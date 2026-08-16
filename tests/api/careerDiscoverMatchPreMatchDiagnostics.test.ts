import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { createApp } from "../../src/api/app.js";
import type { JobSource, RawProviderJob } from "../../src/jobSources/jobSource.js";
import type { DiscoverMatchResult } from "../../src/schemas/careerDiscoverMatch.js";

const API_KEY = "test-career-agent-key";

const matchingProfile = {
  professionalTitle: "Principal Software Quality Engineer",
  coreSkills: "Playwright, API Testing, SQL"
};

const GENERIC_NON_QA_DESCRIPTION =
  "This role focuses on day-to-day operations and cross-team coordination. Occasionally reviews quality reports for accuracy.";
const GENUINE_DESCRIPTION =
  "Own quality engineering strategy and test architecture across a growing platform, including automation, API testing, and CI/CD ownership.";

function rawJob(source: string, id: string, title: string, overrides: Record<string, unknown> = {}): RawProviderJob {
  return {
    jobTitle: title,
    company: `Company ${id}`,
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: GENUINE_DESCRIPTION,
    requirements: ["See description"],
    responsibilities: ["See description"],
    skills: ["Testing"],
    source,
    sourceUrl: `https://${source}.example/${id}`,
    datePosted: "2026-08-16",
    externalJobId: id,
    ...overrides
  };
}

function fakeSource(name: string, jobs: RawProviderJob[]): JobSource {
  return {
    name,
    searchJobs: vi.fn(async () => jobs),
    async getJob() {
      return null;
    },
    normalize(raw: RawProviderJob) {
      return raw;
    }
  };
}

function qaMatchJson(): string {
  return JSON.stringify({
    matchScore: 85,
    interviewPotential: 75,
    careerGrowth: 70,
    futureAIValue: 60,
    recommendation: "APPLY",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason",
    careerRelevanceScore: 90,
    whySelected: "Strong alignment with the target career family."
  });
}

function claudeClient(): Anthropic {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: qaMatchJson() }] }));
  return { messages: { create } } as unknown as Anthropic;
}

describe("POST /career/discover-match — preMatchDiagnostics observability (Phase 8.5.17)", () => {
  it("reports a preMatchDiagnostics breakdown that reconciles against jobsAfterFiltering, and never changes existing fields", async () => {
    const jobs = [
      rawJob("himalayas", "qa-1", "Principal QA Engineer"), // qualifies, TIER_1
      rawJob("himalayas", "qa-2", "Senior QA Engineer"), // qualifies, TIER_3
      rawJob("himalayas", "neg-1", "Tier III Service Desk Engineer"), // hard negative
      rawJob("himalayas", "nonqa-1", "Manufacturing QA Technician"), // non-software-QA
      rawJob("himalayas", "irrelevant-1", "Sales Representative", { jobDescription: GENERIC_NON_QA_DESCRIPTION, skills: ["General"] }),
      rawJob("himalayas", "loc-1", "Senior QA Engineer", { location: "Remote (US only)", country: "United States" }) // location rejected
    ];
    const client = claudeClient();
    const app = createApp({
      apiKey: API_KEY,
      jobSources: [fakeSource("himalayas", jobs)],
      claudeClient: client,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 10, topJobs: 5 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;

    // Existing fields untouched.
    expect(body.jobsAfterFiltering).toBe(6);
    expect(body.preMatchFiltered).toBe(4);
    expect(body.jobsSentToMatching).toBe(2);
    expect(body.jobsMatched).toBe(2);

    // New field, additive.
    expect(body.preMatchDiagnostics).toBeDefined();
    const diag = body.preMatchDiagnostics!;
    expect(diag.locationRejected).toBe(1);
    expect(diag.hardNegativeRejected).toBe(1);
    expect(diag.nonSoftwareQaRejected).toBe(1);
    expect(diag.positiveCareerRejected).toBe(1);
    expect(diag.qualifiedForMatching).toBe(2);

    // §9 reconciliation invariant.
    const sum = diag.locationRejected + diag.hardNegativeRejected + diag.nonSoftwareQaRejected + diag.positiveCareerRejected + diag.qualifiedForMatching;
    expect(sum).toBe(body.jobsAfterFiltering);

    expect(diag.byTier.afterBasicFilter.TIER_1).toBe(1);
    expect(diag.bySource.himalayas).toEqual({ afterBasicFilter: 6, qualified: 2, rejected: 4 });
  });

  it("[CASE I] jobsSentToMatching never exceeds maxJobs, even when more candidates qualify than the cap allows — and qualifiedForMatching (pre-cap) can legitimately exceed it", async () => {
    const qualifyingJobs = Array.from({ length: 5 }, (_, i) => rawJob("himalayas", `qa-${i}`, `Senior QA Engineer ${i}`));
    const client = claudeClient();
    const app = createApp({
      apiKey: API_KEY,
      jobSources: [fakeSource("himalayas", qualifyingJobs)],
      claudeClient: client,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 2, topJobs: 2 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;

    expect(body.jobsSentToMatching).toBeLessThanOrEqual(2);
    expect(body.jobsSentToMatching).toBe(2);
    // All 5 qualified the pre-Claude filter chain, but only 2 (maxJobs) were actually sent.
    expect(body.preMatchDiagnostics!.qualifiedForMatching).toBe(5);
    expect(body.jobsSentToMatching).toBeLessThanOrEqual(body.preMatchDiagnostics!.qualifiedForMatching);
  });

  it("omits preMatchDiagnostics when no job ever reaches the pre-Claude filter stage (e.g. zero jobs discovered)", async () => {
    const client = claudeClient();
    const app = createApp({
      apiKey: API_KEY,
      jobSources: [fakeSource("himalayas", [])],
      claudeClient: client,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.preMatchDiagnostics).toBeUndefined();
  });
});
