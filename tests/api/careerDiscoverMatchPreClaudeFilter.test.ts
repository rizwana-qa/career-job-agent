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

function rawJob(overrides: Record<string, unknown> = {}): RawProviderJob {
  return {
    company: "Remote Co",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    requirements: ["See description"],
    responsibilities: ["See description"],
    skills: ["General"],
    source: "remotive",
    datePosted: "2026-08-10",
    ...overrides
  };
}

function fakeJobSource(jobs: RawProviderJob[]): JobSource {
  return {
    name: "fake-source",
    searchJobs: vi.fn(async () => jobs),
    async getJob() {
      return null;
    },
    normalize(raw: RawProviderJob) {
      return raw;
    }
  };
}

function matchJson(overrides: Record<string, unknown> = {}): string {
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
    whySelected: "Strong alignment with the target career family.",
    ...overrides
  });
}

function queueClaudeClient(items: string[]): Anthropic {
  let index = 0;
  const create = vi.fn(async () => {
    const text = items[index];
    if (text === undefined) {
      throw new Error(`queueClaudeClient: no mock response queued for call #${index + 1}`);
    }
    index += 1;
    return { content: [{ type: "text", text }] };
  });
  return { messages: { create } } as unknown as Anthropic;
}

/**
 * Phase 8.3.3 — reproduces the production report (obviously unrelated jobs
 * reaching Claude and only getting rejected after) as a regression: with the
 * strengthened pre-Claude filter, none of these should ever generate a
 * Claude call at all.
 */
describe("POST /career/discover-match — strengthened pre-Claude filter (Phase 8.3.3)", () => {
  it("rejects obviously unrelated jobs before Claude and never calls Claude for them, while a genuine QA job still reaches Claude", async () => {
    // Both unrelated jobs mention a single bare "quality"/"test" word — the
    // EXISTING basic deterministic filter (jobFilterService.ts) already lets
    // these through on that alone (this reproduces the actual production
    // report: these jobs DID reach Claude before this phase). The NEW
    // positive prefilter is what's meant to catch them now: neither
    // description contains a real secondary-signal PHRASE (e.g. "Software
    // Testing", "AI Quality"), so hasPositiveCareerSignal() correctly stays
    // false even though the old basic filter alone would have let them through.
    const jobs = [
      rawJob({
        externalJobId: "office-assistant",
        sourceUrl: "https://remotive.com/office-assistant",
        jobTitle: "Remote Office Assistant",
        jobDescription: "Support daily office operations and administrative tasks. Occasionally review vendor quality reports for accuracy.",
        skills: ["Scheduling"],
        responsibilities: ["Manage calendars"],
        requirements: ["Organizational skills"]
      }),
      rawJob({
        externalJobId: "face-dedup",
        sourceUrl: "https://remotive.com/face-dedup",
        jobTitle: "Face Deduplication Collection",
        jobDescription: "Help collect and label facial image data for a research dataset. You'll test data collection scripts occasionally.",
        skills: ["Data collection"],
        responsibilities: ["Collect images"],
        requirements: ["Attention to detail"]
      }),
      rawJob({
        externalJobId: "qualifies",
        sourceUrl: "https://remotive.com/qualifies",
        jobTitle: "Senior QA Engineer",
        jobDescription: "Own test automation strategy for our platform, working closely with engineering on release quality.",
        skills: ["QA", "Automation"],
        responsibilities: ["Own test strategy"],
        requirements: ["QA experience"]
      })
    ];
    const claudeClient = queueClaudeClient([matchJson()]); // exactly one response queued — proves only 1 call happens

    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource(jobs), claudeClient, profile: matchingProfile, jobDiscoveryPreferences: {} });
    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.jobsAfterFiltering).toBe(3); // all 3 pass the basic deterministic filter
    expect(body.preMatchFiltered).toBe(2); // Office Assistant + Face Deduplication Collection
    expect(body.relevanceFiltered).toBe(2); // same count, backward-compatible field name
    expect(body.jobsSentToMatching).toBe(1); // only the QA job
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(1);
    expect(body.jobsMatched).toBe(1);
    expect(body.topJobs).toHaveLength(1);
    expect(body.topJobs[0].jobTitle).toBe("Senior QA Engineer");
  });

  it("makes the full pipeline measurable end to end via the response counts", async () => {
    const jobs = [
      ...Array.from({ length: 4 }, (_, i) =>
        rawJob({
          externalJobId: `qa-${i}`,
          sourceUrl: `https://remotive.com/qa-${i}`,
          jobTitle: "Lead QA Engineer",
          jobDescription: "Lead quality engineering efforts across multiple product teams, driving automation adoption."
        })
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        rawJob({
          externalJobId: `unrelated-${i}`,
          sourceUrl: `https://remotive.com/unrelated-${i}`,
          jobTitle: "Data Entry Clerk",
          jobDescription: "Enter data into spreadsheets accurately and efficiently, following provided quality templates.",
          skills: ["Typing"],
          responsibilities: ["Enter data"],
          requirements: ["Attention to detail"]
        })
      )
    ];
    const claudeClient = queueClaudeClient([matchJson(), matchJson(), matchJson(), matchJson()]);

    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource(jobs), claudeClient, profile: matchingProfile, jobDiscoveryPreferences: {} });
    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({ maxJobs: 8, topJobs: 8 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.jobsDiscovered).toBe(8);
    expect(body.jobsAfterFiltering).toBe(8);
    expect(body.preMatchFiltered).toBe(4); // the 4 Data Entry Clerk postings
    expect(body.jobsSentToMatching).toBe(4); // only the 4 QA postings
    expect(body.jobsMatched).toBe(4);
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(4);
  });
});
