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

function rawJob(id: string, title: string): RawProviderJob {
  return {
    jobTitle: title,
    company: "Acme Corp",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: "Own quality engineering strategy across a growing SaaS platform, including automation and API testing.",
    requirements: ["See description"],
    responsibilities: ["See description"],
    skills: ["Testing"],
    source: "himalayas",
    sourceUrl: `https://himalayas.example/${id}`,
    datePosted: "2026-08-10",
    externalJobId: id
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
    interviewPotential: 70,
    careerGrowth: 65,
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

function fakeClaudeClient(): Anthropic {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: qaMatchJson() }] }));
  return { messages: { create } } as unknown as Anthropic;
}

/** Phase 8.5.7 §10 — optional, safe searchResultsByTier tally in the discover-match response. */
describe("POST /career/discover-match — optional searchResultsByTier field (Phase 8.5.7 §10)", () => {
  it("tallies classifySearchTier() over the jobs Claude evaluated, without altering existing fields", async () => {
    const jobs = [
      rawJob("1", "Principal QA Engineer"), // TIER_1
      rawJob("2", "Lead QA Engineer"), // TIER_2
      rawJob("3", "AI Quality Engineer") // TIER_4
    ];
    const claudeClient = fakeClaudeClient();
    const app = createApp({
      apiKey: API_KEY,
      jobSources: [fakeSource("himalayas", jobs)],
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 10, topJobs: 5 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.jobsMatched).toBe(3);
    expect(body.searchResultsByTier).toEqual({ TIER_1: 1, TIER_2: 1, TIER_4: 1 });
  });

  it("omits searchResultsByTier when no jobs reached Claude", async () => {
    const claudeClient = fakeClaudeClient();
    const app = createApp({
      apiKey: API_KEY,
      jobSources: [fakeSource("himalayas", [])],
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.searchResultsByTier).toBeUndefined();
  });
});
