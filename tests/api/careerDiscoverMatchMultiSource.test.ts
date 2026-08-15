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
    jobTitle: "Quality Engineer",
    company: "Some Co",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: "A sufficiently long job description mentioning quality engineering and testing responsibilities.",
    requirements: ["Testing experience"],
    responsibilities: ["Test the product"],
    skills: ["Testing", "QA"],
    datePosted: "2026-08-10",
    ...overrides
  };
}

function fakeSource(name: string, jobs: RawProviderJob[], searchJobsImpl?: () => Promise<RawProviderJob[]>): JobSource {
  return {
    name,
    searchJobs: searchJobsImpl ? vi.fn(searchJobsImpl) : vi.fn(async () => jobs),
    async getJob() {
      return null;
    },
    normalize(raw: RawProviderJob) {
      return raw; // fixtures are already Job-schema-shaped
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

function queueClaudeClient(count: number): Anthropic {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: matchJson() }] }));
  void count;
  return { messages: { create } } as unknown as Anthropic;
}

describe("POST /career/discover-match — mixed source scenario (Phase 8.4 §13)", () => {
  it("aggregates 20 raw jobs across 4 sources (5 each), deduplicates 3 cross-source duplicates before Claude matching, and calls Claude exactly 17 times", async () => {
    // Cross-source duplicate pairs (same company+title, different source/id):
    //  - "AI Quality Engineer" @ "Vantage AI": remotive + indeed
    //  - "QA Architect" @ "Titan Corp": remotive + gulftalent
    //  - "SDET" @ "Falcon Group": naukrigulf + gulftalent
    const remotiveJobs = [
      rawJob({ source: "remotive", externalJobId: "r-1", sourceUrl: "https://remotive.com/r-1", jobTitle: "AI Quality Engineer", company: "Vantage AI" }),
      rawJob({ source: "remotive", externalJobId: "r-2", sourceUrl: "https://remotive.com/r-2", jobTitle: "QA Architect", company: "Titan Corp" }),
      rawJob({ source: "remotive", externalJobId: "r-3", sourceUrl: "https://remotive.com/r-3", jobTitle: "Staff SDET", company: "Remote Labs" }),
      rawJob({ source: "remotive", externalJobId: "r-4", sourceUrl: "https://remotive.com/r-4", jobTitle: "Principal Quality Engineer", company: "CloudWorks" }),
      rawJob({ source: "remotive", externalJobId: "r-5", sourceUrl: "https://remotive.com/r-5", jobTitle: "Quality Engineering Manager", company: "DataFlow" })
    ];
    const indeedJobs = [
      rawJob({ source: "indeed", externalJobId: "i-1", sourceUrl: "https://indeed.com/i-1", jobTitle: "AI Quality Engineer", company: "Vantage AI" }),
      rawJob({ source: "indeed", externalJobId: "i-2", sourceUrl: "https://indeed.com/i-2", jobTitle: "Senior QA Engineer", company: "Gulf Tech" }),
      rawJob({ source: "indeed", externalJobId: "i-3", sourceUrl: "https://indeed.com/i-3", jobTitle: "Test Automation Architect", company: "Falcon Automation" }),
      rawJob({ source: "indeed", externalJobId: "i-4", sourceUrl: "https://indeed.com/i-4", jobTitle: "QA Lead", company: "Bright Apps" }),
      rawJob({ source: "indeed", externalJobId: "i-5", sourceUrl: "https://indeed.com/i-5", jobTitle: "SDET", company: "NorthStar" })
    ];
    const naukrigulfJobs = [
      rawJob({ source: "naukrigulf", externalJobId: "n-1", sourceUrl: "https://naukrigulf.com/n-1", jobTitle: "SDET", company: "Falcon Group" }),
      rawJob({ source: "naukrigulf", externalJobId: "n-2", sourceUrl: "https://naukrigulf.com/n-2", jobTitle: "QA Automation Lead", company: "Emirates Digital" }),
      rawJob({ source: "naukrigulf", externalJobId: "n-3", sourceUrl: "https://naukrigulf.com/n-3", jobTitle: "Software Quality Architect", company: "Desert Tech" }),
      rawJob({ source: "naukrigulf", externalJobId: "n-4", sourceUrl: "https://naukrigulf.com/n-4", jobTitle: "Lead QA Engineer", company: "Gulf Systems" }),
      rawJob({ source: "naukrigulf", externalJobId: "n-5", sourceUrl: "https://naukrigulf.com/n-5", jobTitle: "AI Test Engineer", company: "Oasis AI" })
    ];
    const gulfTalentJobs = [
      rawJob({ source: "gulftalent", externalJobId: "g-1", sourceUrl: "https://gulftalent.com/g-1", jobTitle: "QA Architect", company: "Titan Corp" }),
      rawJob({ source: "gulftalent", externalJobId: "g-2", sourceUrl: "https://gulftalent.com/g-2", jobTitle: "SDET", company: "Falcon Group" }),
      rawJob({ source: "gulftalent", externalJobId: "g-3", sourceUrl: "https://gulftalent.com/g-3", jobTitle: "Principal Quality Engineer", company: "Nova Tech" }),
      rawJob({ source: "gulftalent", externalJobId: "g-4", sourceUrl: "https://gulftalent.com/g-4", jobTitle: "RAG Testing Engineer", company: "Nimbus AI" }),
      rawJob({ source: "gulftalent", externalJobId: "g-5", sourceUrl: "https://gulftalent.com/g-5", jobTitle: "Quality Engineering Lead", company: "Zenith" })
    ];

    const claudeClient = queueClaudeClient(17);
    const app = createApp({
      apiKey: API_KEY,
      jobSources: [
        fakeSource("remotive", remotiveJobs),
        fakeSource("indeed", indeedJobs),
        fakeSource("naukrigulf", naukrigulfJobs),
        fakeSource("gulftalent", gulfTalentJobs)
      ],
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 20, topJobs: 20 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;

    expect(body.jobsDiscovered).toBe(20); // 5 + 5 + 5 + 5, before any dedup
    expect(body.jobsAfterFiltering).toBe(17); // 20 - 3 cross-source duplicates
    expect(body.jobsMatched).toBe(17);
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(17); // never once per raw job — duplicates never reach Claude
    expect(body.sources).toEqual(
      expect.arrayContaining([
        { name: "remotive", status: "OK", jobsFound: 5 },
        { name: "indeed", status: "OK", jobsFound: 5 },
        { name: "naukrigulf", status: "OK", jobsFound: 5 },
        { name: "gulftalent", status: "OK", jobsFound: 5 }
      ])
    );
  });
});

describe("POST /career/discover-match — source failure isolation (Phase 8.4 §12)", () => {
  it("continues the run when one of several sources fails, reporting it FAILED in sources[] and the rest OK", async () => {
    const workingJobs = [rawJob({ source: "remotive", externalJobId: "1", sourceUrl: "https://remotive.com/1", jobTitle: "Principal QA Engineer" })];
    const claudeClient = queueClaudeClient(1);

    const app = createApp({
      apiKey: API_KEY,
      jobSources: [
        fakeSource("indeed", [], async () => {
          throw new Error("Indeed simulated failure");
        }),
        fakeSource("naukrigulf", workingJobs),
        fakeSource("gulftalent", [])
      ],
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.status).toBe("PARTIAL"); // one source failed, the rest succeeded
    expect(body.sources).toEqual(
      expect.arrayContaining([
        { name: "indeed", status: "FAILED" },
        { name: "naukrigulf", status: "OK", jobsFound: 1 },
        { name: "gulftalent", status: "OK", jobsFound: 0 }
      ])
    );
    expect(body.jobsDiscovered).toBe(1); // only from the sources that succeeded
    // The credentials/internal error text is never leaked into the response.
    expect(JSON.stringify(body)).not.toContain("simulated failure");
  });

  it("returns FAILED status when every configured source fails", async () => {
    const app = createApp({
      apiKey: API_KEY,
      jobSources: [
        fakeSource("indeed", [], async () => {
          throw new Error("Indeed down");
        }),
        fakeSource("naukrigulf", [], async () => {
          throw new Error("Naukrigulf down");
        })
      ],
      claudeClient: queueClaudeClient(0),
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.status).toBe("FAILED");
    expect(body.sources).toEqual([
      { name: "indeed", status: "FAILED" },
      { name: "naukrigulf", status: "FAILED" }
    ]);
    expect(body.topJobs).toEqual([]);
  });

  it("Remotive continues working normally when it is the only enabled source", async () => {
    const claudeClient = queueClaudeClient(1);
    const app = createApp({
      apiKey: API_KEY,
      jobSources: [fakeSource("remotive", [rawJob({ source: "remotive", externalJobId: "1", sourceUrl: "https://remotive.com/1" })])],
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("COMPLETED");
    expect(response.body.sources).toEqual([{ name: "remotive", status: "OK", jobsFound: 1 }]);
  });
});
