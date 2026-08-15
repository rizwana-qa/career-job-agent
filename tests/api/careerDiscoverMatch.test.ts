import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { createApp } from "../../src/api/app.js";
import { InMemoryIdempotencyStore } from "../../src/services/careerOrchestrationService.js";
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
    company: "Remote Co",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: "A sufficiently long job description mentioning quality engineering and testing responsibilities.",
    requirements: ["Testing experience"],
    responsibilities: ["Test the product"],
    skills: ["Testing", "QA"],
    source: "remotive",
    sourceUrl: "https://remotive.com/remote-jobs/qa/job-1",
    datePosted: "2026-08-10",
    externalJobId: "1",
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
    matchScore: 75,
    interviewPotential: 60,
    careerGrowth: 55,
    futureAIValue: 50,
    recommendation: "CONSIDER",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason",
    // Career Relevance Gate (Phase 8.3) default — passes the >= 70 gate by
    // default so existing tests about matching/ranking/idempotency don't
    // need to know about the gate unless they're specifically testing it.
    careerRelevanceScore: 85,
    whySelected: "Strong alignment with the target career family.",
    ...overrides
  });
}

function nonRetryableFailure(): never {
  throw Object.assign(new Error("Bad Request"), { status: 400 });
}

type QueueItem = string | (() => string);

function queueClaudeClient(items: QueueItem[]): Anthropic {
  let index = 0;
  const create = vi.fn(async () => {
    const item = items[index];
    if (item === undefined) {
      throw new Error(`queueClaudeClient: no mock response queued for call #${index + 1}`);
    }
    index += 1;
    const text = typeof item === "function" ? item() : item;
    return { content: [{ type: "text", text }] };
  });
  return { messages: { create } } as unknown as Anthropic;
}

function baseAppDeps(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: API_KEY,
    profile: matchingProfile,
    jobDiscoveryPreferences: {},
    ...overrides
  };
}

describe("POST /career/discover-match — authentication", () => {
  it("returns 401 with 'Missing API key' when no Authorization header is sent", async () => {
    const app = createApp(baseAppDeps({ jobSource: fakeJobSource([]) }));
    const response = await request(app).post("/career/discover-match").send({});

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Missing API key");
  });

  it("returns 401 with 'Invalid API key' for a wrong bearer token", async () => {
    const app = createApp(baseAppDeps({ jobSource: fakeJobSource([]) }));
    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", "Bearer wrong-key")
      .send({});

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid API key");
  });

  it("returns 503 when the server has no CAREER_AGENT_API_KEY configured at all", async () => {
    const app = createApp(baseAppDeps({ apiKey: undefined, jobSource: fakeJobSource([]) }));
    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", "Bearer anything")
      .send({});

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("Orchestration API is not configured");
  });
});

describe("POST /career/discover-match — successful discovery", () => {
  it("returns COMPLETED with a fully populated top job, including jobData for round-tripping", async () => {
    const claudeClient = queueClaudeClient([matchJson({ matchScore: 88, recommendation: "APPLY" })]);
    const app = createApp(baseAppDeps({ claudeClient, jobSource: fakeJobSource([rawJob()]) }));

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.status).toBe("COMPLETED");
    expect(body.jobsDiscovered).toBe(1);
    expect(body.jobsAfterFiltering).toBe(1);
    expect(body.jobsMatched).toBe(1);
    expect(body.matchingFailures).toBe(0);
    expect(body.topJobs).toHaveLength(1);
    expect(body.topJobs[0].jobId).toBe("1");
    expect(body.topJobs[0].matchScore).toBe(88);
    expect(body.topJobs[0].recommendation).toBe("APPLY");
    expect(body.topJobs[0].careerRelevanceScore).toBe(85);
    expect(body.topJobs[0].whySelected.length).toBeGreaterThan(0);
    expect(body.relevanceFiltered).toBe(0);
    expect(body.topJobs[0].jobData.job.jobTitle).toBe("Quality Engineer");
    expect(body.topJobs[0].jobData.match.matchScore).toBe(88);
    // Phase 8.4 additions.
    expect(body.topJobs[0].country).toBe("Worldwide");
    expect(body.topJobs[0].remoteStatus).toBe("REMOTE");
    expect(body.topJobs[0].employmentType).toBe("FULL_TIME");
    expect(body.topJobs[0].datePosted).toBe("2026-08-10");
    expect(body.sources).toEqual([{ name: "fake-source", status: "OK", jobsFound: 1 }]);
  });
});

describe("POST /career/discover-match — partial matching", () => {
  it("returns PARTIAL with matchingFailures when some jobs match and some fail", async () => {
    const jobs = [
      rawJob({ externalJobId: "1", sourceUrl: "https://remotive.com/job-1" }),
      rawJob({ externalJobId: "2", sourceUrl: "https://remotive.com/job-2" })
    ];
    const claudeClient = queueClaudeClient([matchJson({ matchScore: 90 }), nonRetryableFailure]);
    const app = createApp(baseAppDeps({ claudeClient, jobSource: fakeJobSource(jobs) }));

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.status).toBe("PARTIAL");
    expect(body.jobsMatched).toBe(1);
    expect(body.matchingFailures).toBe(1);
    expect(body.topJobs).toHaveLength(1);
  });
});

describe("POST /career/discover-match — all matching failures", () => {
  it("returns FAILED when every eligible job fails to match", async () => {
    const jobs = [
      rawJob({ externalJobId: "1", sourceUrl: "https://remotive.com/job-1" }),
      rawJob({ externalJobId: "2", sourceUrl: "https://remotive.com/job-2" })
    ];
    const claudeClient = queueClaudeClient([nonRetryableFailure, nonRetryableFailure]);
    const app = createApp(baseAppDeps({ claudeClient, jobSource: fakeJobSource(jobs) }));

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.status).toBe("FAILED");
    expect(body.jobsMatched).toBe(0);
    expect(body.matchingFailures).toBe(2);
    expect(body.topJobs).toEqual([]);
  });
});

describe("POST /career/discover-match — zero results", () => {
  it("returns COMPLETED with all-zero counts and never calls Claude when no jobs are found", async () => {
    const claudeClient = queueClaudeClient([]);
    const app = createApp(baseAppDeps({ claudeClient, jobSource: fakeJobSource([]) }));

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.status).toBe("COMPLETED");
    expect(body.jobsDiscovered).toBe(0);
    expect(body.topJobs).toEqual([]);
    expect(claudeClient.messages.create).not.toHaveBeenCalled();
  });
});

describe("POST /career/discover-match — ranking and topJobs", () => {
  it("returns topJobs sorted by careerScore (higher match first) and honors the topJobs limit", async () => {
    const jobs = [
      rawJob({ externalJobId: "1", sourceUrl: "https://remotive.com/job-1", jobTitle: "Lower Match" }),
      rawJob({ externalJobId: "2", sourceUrl: "https://remotive.com/job-2", jobTitle: "Higher Match" }),
      rawJob({ externalJobId: "3", sourceUrl: "https://remotive.com/job-3", jobTitle: "Middle Match" })
    ];
    const claudeClient = queueClaudeClient([
      matchJson({ matchScore: 78 }), // job 1 — lowest of the three, but still passes the gate on its own
      matchJson({ matchScore: 95 }), // job 2 — highest
      matchJson({ matchScore: 88 }) // job 3 — middle
    ]);
    const app = createApp(baseAppDeps({ claudeClient, jobSource: fakeJobSource(jobs) }));

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ topJobs: 2 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    // All 3 pass the Career Relevance Gate on their own merits — this test
    // isolates ranking + the topJobs cap, not gate rejection (that's
    // covered separately in the Career Relevance Gate test suite below).
    expect(body.topJobs).toHaveLength(2); // topJobs: 2 caps the result, even though 3 jobs matched
    expect(body.topJobs[0].jobTitle).toBe("Higher Match");
    expect(body.topJobs[1].jobTitle).toBe("Middle Match");
  });
});

describe("POST /career/discover-match — maxJobs limit", () => {
  it("only sends maxJobs eligible jobs to Claude, even when more are discovered", async () => {
    const jobs = [
      rawJob({ externalJobId: "1", sourceUrl: "https://remotive.com/job-1" }),
      rawJob({ externalJobId: "2", sourceUrl: "https://remotive.com/job-2" }),
      rawJob({ externalJobId: "3", sourceUrl: "https://remotive.com/job-3" })
    ];
    const claudeClient = queueClaudeClient([matchJson(), matchJson()]);
    const app = createApp(baseAppDeps({ claudeClient, jobSource: fakeJobSource(jobs) }));

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 2, topJobs: 5 });

    expect(response.status).toBe(200);
    expect(response.body.jobsDiscovered).toBe(3);
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(2);
  });
});

describe("POST /career/discover-match — idempotency", () => {
  it("returns the cached result and never re-calls Claude for a repeated Idempotency-Key", async () => {
    const claudeClient = queueClaudeClient([matchJson()]);
    const idempotencyStore = new InMemoryIdempotencyStore<DiscoverMatchResult>();
    const app = createApp(baseAppDeps({ claudeClient, jobSource: fakeJobSource([rawJob()]), idempotencyStore }));

    const first = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "discover-run-1")
      .send({});
    const second = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "discover-run-1")
      .send({});

    expect(first.body).toEqual(second.body);
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(1);
  });
});

/**
 * Career Relevance Gate — Claude-scored gate test cases (Phase 8.3 §6).
 * Cases D-H (qualifying career-family roles) and J-L (the three-condition
 * gate itself: recommendation, careerRelevanceScore, matchScore). Cases
 * A, B, C, I (the hard negative title filter) live in
 * tests/services/careerRelevanceFilter.test.ts since they don't need a
 * mocked Claude response at all.
 */
describe("POST /career/discover-match — Career Relevance Gate (Phase 8.3 §6)", () => {
  async function runSingleJobGate(jobTitle: string, matchOverrides: Record<string, unknown>) {
    const claudeClient = queueClaudeClient([matchJson(matchOverrides)]);
    const app = createApp(baseAppDeps({ claudeClient, jobSource: fakeJobSource([rawJob({ jobTitle })]) }));
    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({});
    return response.body as DiscoverMatchResult;
  }

  it("[D] admits a 'Principal Software Quality Engineer' role that clears both thresholds with APPLY", async () => {
    const body = await runSingleJobGate("Principal Software Quality Engineer", {
      careerRelevanceScore: 90,
      matchScore: 85,
      recommendation: "APPLY"
    });
    expect(body.topJobs).toHaveLength(1);
  });

  it("[E] admits a 'Staff Software Quality Engineer' role that clears both thresholds with CONSIDER", async () => {
    const body = await runSingleJobGate("Staff Software Quality Engineer", {
      careerRelevanceScore: 80,
      matchScore: 75,
      recommendation: "CONSIDER"
    });
    expect(body.topJobs).toHaveLength(1);
  });

  it("[F] admits an 'AI Quality Engineer' role that clears both thresholds with APPLY", async () => {
    const body = await runSingleJobGate("AI Quality Engineer", {
      careerRelevanceScore: 95,
      matchScore: 90,
      recommendation: "APPLY"
    });
    expect(body.topJobs).toHaveLength(1);
  });

  it("[G] admits a 'Senior SDET' role that clears both thresholds with CONSIDER", async () => {
    const body = await runSingleJobGate("Senior SDET", {
      careerRelevanceScore: 72,
      matchScore: 71,
      recommendation: "CONSIDER"
    });
    expect(body.topJobs).toHaveLength(1);
  });

  it("[H] admits a 'QA Architect' role (AI testing focus) that clears both thresholds with APPLY", async () => {
    const body = await runSingleJobGate("QA Architect", {
      careerRelevanceScore: 88,
      matchScore: 82,
      recommendation: "APPLY"
    });
    expect(body.topJobs).toHaveLength(1);
  });

  it("[J] excludes a job with a REJECT recommendation even when both scores are high", async () => {
    const body = await runSingleJobGate("Principal Software Quality Engineer", {
      careerRelevanceScore: 95,
      matchScore: 95,
      recommendation: "REJECT"
    });
    expect(body.topJobs).toEqual([]);
  });

  it("[K] admits a CONSIDER recommendation exactly at the 70/70 boundary", async () => {
    const body = await runSingleJobGate("Staff QA Engineer", {
      careerRelevanceScore: 70,
      matchScore: 70,
      recommendation: "CONSIDER"
    });
    expect(body.topJobs).toHaveLength(1);
  });

  it("[L] admits an APPLY recommendation exactly at the 70/70 boundary, but excludes one point below it", async () => {
    const admitted = await runSingleJobGate("Lead QA Engineer", {
      careerRelevanceScore: 70,
      matchScore: 70,
      recommendation: "APPLY"
    });
    expect(admitted.topJobs).toHaveLength(1);

    const excludedByRelevance = await runSingleJobGate("Lead QA Engineer", {
      careerRelevanceScore: 69,
      matchScore: 90,
      recommendation: "APPLY"
    });
    expect(excludedByRelevance.topJobs).toEqual([]);

    const excludedByMatch = await runSingleJobGate("Lead QA Engineer", {
      careerRelevanceScore: 90,
      matchScore: 69,
      recommendation: "APPLY"
    });
    expect(excludedByMatch.topJobs).toEqual([]);
  });
});

describe("POST /career/discover-match — safe response", () => {
  it("never includes career profile content in the response", async () => {
    const claudeClient = queueClaudeClient([matchJson()]);
    const app = createApp(
      baseAppDeps({
        claudeClient,
        jobSource: fakeJobSource([rawJob()]),
        profile: { ...matchingProfile, professionalTitle: "SECRET_PROFILE_TITLE_MARKER" }
      })
    );

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({});

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("SECRET_PROFILE_TITLE_MARKER");
    expect(serialized).not.toContain(API_KEY);
  });
});
