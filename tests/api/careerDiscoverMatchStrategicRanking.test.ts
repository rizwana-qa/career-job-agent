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

function rawJob(id: string, title: string, jobDescription: string, overrides: Record<string, unknown> = {}): RawProviderJob {
  return {
    jobTitle: title,
    company: `Company ${id}`,
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription,
    requirements: ["See description"],
    responsibilities: ["See description"],
    skills: ["QA", "Testing"],
    source: "himalayas",
    sourceUrl: `https://himalayas.example/${id}`,
    datePosted: "2026-08-10",
    externalJobId: id,
    ...overrides
  };
}

function fakeSource(jobs: RawProviderJob[]): JobSource {
  return {
    name: "himalayas",
    searchJobs: vi.fn(async () => jobs),
    async getJob() {
      return null;
    },
    normalize(raw: RawProviderJob) {
      return raw;
    }
  };
}

interface MatchFixture {
  matchScore: number;
  interviewPotential: number;
  careerGrowth: number;
  futureAIValue: number;
  recommendation: string;
  careerRelevanceScore: number;
}

function matchJson(fixture: MatchFixture): string {
  return JSON.stringify({
    ...fixture,
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason",
    whySelected: "test fixture whySelected"
  });
}

function queueClaudeClient(responses: string[]): Anthropic {
  let index = 0;
  const create = vi.fn(async () => {
    const text = responses[index];
    if (text === undefined) {
      throw new Error(`no mock response queued for call #${index + 1}`);
    }
    index += 1;
    return { content: [{ type: "text", text }] };
  });
  return { messages: { create } } as unknown as Anthropic;
}

/**
 * Phase 8.5.5 §10 — CoverGo-style regression + two synthetic stronger
 * competitors, matching the exact real production score shape.
 */
describe("POST /career/discover-match — CoverGo regression (Phase 8.5.5 §10)", () => {
  it("a Principal QA Architect and an AI Quality Engineer both outrank a manual-execution-heavy CoverGo-shaped Senior QA role", async () => {
    const coverGoJob = rawJob(
      "covergo",
      "Senior Software QA Engineer",
      "Execute defined test cases and manual testing under guidance. Basic bug reporting and support testing for the insurance platform."
    );
    const principalArchitectJob = rawJob(
      "example-a",
      "Principal QA Architect",
      "Own test architecture and automation architecture strategy across the organization, driving quality engineering strategy and technical leadership."
    );
    const aiQualityJob = rawJob(
      "example-b",
      "AI Quality Engineer",
      "Own AI test architecture and framework ownership for LLM evaluation and RAG testing, leading QA initiatives for our AI platform."
    );

    // Exact score shape from the real production report.
    const coverGoMatch: MatchFixture = {
      matchScore: 73,
      interviewPotential: 72,
      careerGrowth: 42,
      futureAIValue: 30,
      recommendation: "CONSIDER",
      careerRelevanceScore: 78
    };
    const principalArchitectMatch: MatchFixture = {
      matchScore: 78,
      interviewPotential: 75,
      careerGrowth: 85,
      futureAIValue: 60,
      recommendation: "APPLY",
      careerRelevanceScore: 82
    };
    const aiQualityMatch: MatchFixture = {
      matchScore: 74,
      interviewPotential: 70,
      careerGrowth: 88,
      futureAIValue: 95,
      recommendation: "APPLY",
      careerRelevanceScore: 80
    };

    const claudeClient = queueClaudeClient([
      matchJson(coverGoMatch),
      matchJson(principalArchitectMatch),
      matchJson(aiQualityMatch)
    ]);

    const app = createApp({
      apiKey: API_KEY,
      jobSource: fakeSource([coverGoJob, principalArchitectJob, aiQualityJob]),
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 3, topJobs: 3 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.topJobs).toHaveLength(3); // all three pass the unchanged 70/70 gate

    const order = body.topJobs.map((j) => j.jobId);
    const coverGoRank = order.indexOf("covergo");
    const principalRank = order.indexOf("example-a");
    const aiQualityRank = order.indexOf("example-b");

    // Example A: Principal QA Architect ranks above CoverGo.
    expect(principalRank).toBeLessThan(coverGoRank);
    // Example B: AI Quality Engineer ranks above CoverGo (comparable location/freshness).
    expect(aiQualityRank).toBeLessThan(coverGoRank);

    // sourceUrl and other job identity fields survive ranking untouched.
    const coverGoTopJob = body.topJobs.find((j) => j.jobId === "covergo")!;
    expect(coverGoTopJob.sourceUrl).toBe("https://himalayas.example/covergo");
    expect(coverGoTopJob.jobTitle).toBe("Senior Software QA Engineer");
    expect(coverGoTopJob.source).toBe("himalayas");
    expect(coverGoTopJob.rankingReason.length).toBeGreaterThan(0);
  });

  it("topJobs order reflects strategic ranking, not raw matchScore — a Principal role with a LOWER matchScore than an execution-focused Senior role still ranks first", async () => {
    // Deliberately inverted: the execution-focused Senior role has a HIGHER
    // raw matchScore than the Principal Architect role. If topJobs merely
    // sorted by matchScore (the pre-8.5.5 behavior for this comparison),
    // the Senior role would rank first. It must not.
    const executionJob = rawJob(
      "execution-senior",
      "Senior QA Engineer",
      "Execute defined test cases and manual testing under guidance, following predefined test cases with little autonomy."
    );
    const principalJob = rawJob(
      "principal-architect",
      "Principal QA Architect",
      "Own test architecture and automation architecture strategy, driving technical leadership and quality engineering strategy."
    );

    const executionMatch: MatchFixture = {
      matchScore: 85, // higher raw matchScore
      interviewPotential: 70,
      careerGrowth: 30,
      futureAIValue: 20,
      recommendation: "APPLY",
      careerRelevanceScore: 70
    };
    const principalMatch: MatchFixture = {
      matchScore: 75, // lower raw matchScore
      interviewPotential: 70,
      careerGrowth: 85,
      futureAIValue: 60,
      recommendation: "APPLY",
      careerRelevanceScore: 85
    };

    const claudeClient = queueClaudeClient([matchJson(executionMatch), matchJson(principalMatch)]);
    const app = createApp({
      apiKey: API_KEY,
      jobSource: fakeSource([executionJob, principalJob]),
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 2, topJobs: 2 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.topJobs).toHaveLength(2);
    expect(body.topJobs[0].jobId).toBe("principal-architect"); // ranked first despite the lower matchScore
    expect(body.topJobs[1].jobId).toBe("execution-senior");
  });
});

/** Phase 8.5.5 §11 — proves the system does not simply reject/downrank all Senior titles. */
describe("POST /career/discover-match — Senior QA exception (Phase 8.5.5 §11)", () => {
  it("a genuinely strong Senior Software Quality Engineer role remains highly ranked", async () => {
    const strongSeniorJob = rawJob(
      "strong-senior",
      "Senior Software Quality Engineer",
      "Own automation architecture and framework ownership. Drive API testing strategy with Playwright and CI/CD ownership. Mentor junior engineers on quality strategy."
    );
    const weakJob = rawJob(
      "weak-office",
      "Senior QA Engineer",
      "Execute defined test cases and manual testing under guidance, following predefined test cases."
    );

    const strongMatch: MatchFixture = {
      matchScore: 82,
      interviewPotential: 75,
      careerGrowth: 70,
      futureAIValue: 50,
      recommendation: "APPLY",
      careerRelevanceScore: 88
    };
    const weakMatch: MatchFixture = {
      matchScore: 71,
      interviewPotential: 50,
      careerGrowth: 35,
      futureAIValue: 20,
      recommendation: "CONSIDER",
      careerRelevanceScore: 71
    };

    const claudeClient = queueClaudeClient([matchJson(strongMatch), matchJson(weakMatch)]);
    const app = createApp({
      apiKey: API_KEY,
      jobSource: fakeSource([strongSeniorJob, weakJob]),
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 2, topJobs: 2 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.topJobs[0].jobId).toBe("strong-senior"); // remains top-ranked
  });
});

/** Phase 8.5.5 §12 — a low-scope Senior role that clears the gate stays qualified, but ranks below stronger technical leadership roles. */
describe("POST /career/discover-match — low quality Senior test (Phase 8.5.5 §12)", () => {
  it("a manual-execution Senior role that barely clears 70/70 is still shortlisted, but ranks below a Lead-level competitor", async () => {
    const lowQualitySenior = rawJob(
      "low-quality-senior",
      "Senior QA Engineer",
      "Execute defined tasks with manual testing under guidance, little autonomy, no architecture or strategy ownership."
    );
    const leadJob = rawJob(
      "lead-competitor",
      "Lead QA Engineer",
      "Lead QA initiatives and own test infrastructure, driving cross team quality ownership and CI/CD ownership."
    );

    const lowQualityMatch: MatchFixture = {
      matchScore: 71, // just clears the gate
      interviewPotential: 55,
      careerGrowth: 35,
      futureAIValue: 20,
      recommendation: "CONSIDER",
      careerRelevanceScore: 75 // just clears the gate
    };
    const leadMatch: MatchFixture = {
      matchScore: 80,
      interviewPotential: 72,
      careerGrowth: 75,
      futureAIValue: 45,
      recommendation: "APPLY",
      careerRelevanceScore: 85
    };

    const claudeClient = queueClaudeClient([matchJson(lowQualityMatch), matchJson(leadMatch)]);
    const app = createApp({
      apiKey: API_KEY,
      jobSource: fakeSource([lowQualitySenior, leadJob]),
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 2, topJobs: 2 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    // Still qualified — the gate itself is unchanged.
    expect(body.topJobs).toHaveLength(2);
    expect(body.topJobs.map((j) => j.jobId)).toContain("low-quality-senior");
    // But ranked below the stronger Lead-level competitor.
    expect(body.topJobs[0].jobId).toBe("lead-competitor");
    expect(body.topJobs[1].jobId).toBe("low-quality-senior");
  });

  it("a REJECT-shaped or sub-70 role never enters topJobs at all — the gate is unchanged", async () => {
    const belowGateJob = rawJob("below-gate", "Senior QA Engineer", "Execute defined tasks with manual testing under guidance.");
    const belowGateMatch: MatchFixture = {
      matchScore: 65, // below the unchanged 70 threshold
      interviewPotential: 50,
      careerGrowth: 30,
      futureAIValue: 15,
      recommendation: "CONSIDER",
      careerRelevanceScore: 72
    };

    const claudeClient = queueClaudeClient([matchJson(belowGateMatch)]);
    const app = createApp({
      apiKey: API_KEY,
      jobSource: fakeSource([belowGateJob]),
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.topJobs).toEqual([]); // gate unchanged — a sub-70 matchScore still never qualifies
  });
});
