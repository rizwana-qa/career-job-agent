import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { createApp } from "../../src/api/app.js";
import { InMemoryIdempotencyStore } from "../../src/services/careerOrchestrationService.js";
import type { JobSource, RawProviderJob } from "../../src/jobSources/jobSource.js";

const API_KEY = "test-career-agent-key";

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

function fakeJobSource(jobs: RawProviderJob[], searchJobs?: ReturnType<typeof vi.fn>): JobSource {
  return {
    name: "fake-source",
    searchJobs: searchJobs ?? vi.fn(async () => jobs),
    async getJob() {
      return null;
    },
    normalize(raw: RawProviderJob) {
      return raw;
    }
  };
}

function matchJson(): string {
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
    reason: "test fixture reason"
  });
}

function tailoredResumeJson(): string {
  return JSON.stringify({
    jobId: "placeholder",
    targetRole: "placeholder",
    targetCompany: "placeholder",
    professionalSummary: "Principal QA leader with RAG testing experience.",
    coreSkills: ["Testing"],
    experience: [{ title: "QA Engineer", company: "Clustox", dates: "2022-Present", bullets: ["Did QA work."] }],
    education: [],
    certifications: [],
    matchedRequirements: [],
    transferableRequirements: [],
    gaps: [],
    keywordsAdded: [],
    changesMade: [],
    claimsRequiringVerification: [],
    tailoredResume: "Full tailored resume text — never expected in an API response.",
    status: "READY_FOR_RESUME_QA"
  });
}

function evidenceJson(): string {
  return JSON.stringify({
    status: "PASS",
    evidenceScore: 100,
    claimsReviewed: 0,
    supportedClaims: [],
    transferableClaims: [],
    potentiallyUnsupportedClaims: [],
    unsupportedClaims: [],
    unknownClaims: [],
    recommendations: []
  });
}

function qaPassJson(): string {
  return JSON.stringify({
    status: "PASS",
    overallScore: 85,
    jdAlignmentScore: 80,
    factualAccuracyScore: 90,
    interviewReadinessScore: 85,
    criticalIssues: [],
    highIssues: [],
    mediumIssues: [],
    lowIssues: [],
    strengths: [],
    mandatoryRequirements: [],
    preferredRequirements: [],
    supportedKeywords: [],
    missingImportantKeywords: [],
    unsupportedKeywords: [],
    overusedKeywords: [],
    unsupportedClaims: [],
    transferableClaims: [],
    recommendations: [],
    humanReviewRequired: false
  });
}

function applicationMessageJson(): string {
  return JSON.stringify({ applicationMessage: "Thank you for considering my application — never expected in an API response." });
}

function fullSuccessSequence(): string[] {
  return [matchJson(), tailoredResumeJson(), evidenceJson(), qaPassJson(), applicationMessageJson()];
}

function mockClaudeClient(responses: string[]): Anthropic {
  let index = 0;
  const create = vi.fn(async () => {
    const text = responses[index] ?? responses[responses.length - 1];
    index += 1;
    return { content: [{ type: "text", text }] };
  });
  return { messages: { create } } as unknown as Anthropic;
}

describe("POST /career/run — authentication", () => {
  it("returns 401 with 'Missing API key' when no Authorization header is sent", async () => {
    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource([]) });
    const response = await request(app).post("/career/run").send({});

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Missing API key");
  });

  it("returns 401 with 'Invalid API key' for a wrong bearer token", async () => {
    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource([]) });
    const response = await request(app).post("/career/run").set("Authorization", "Bearer wrong-key").send({});

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid API key");
  });

  it("returns 503 when the server has no CAREER_AGENT_API_KEY configured at all", async () => {
    const app = createApp({ apiKey: undefined, jobSource: fakeJobSource([]) });
    const response = await request(app).post("/career/run").set("Authorization", "Bearer anything").send({});

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("Orchestration API is not configured");
  });

  it("never logs or echoes the configured API key in a response body", async () => {
    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource([]) });
    const response = await request(app).post("/career/run").set("Authorization", "Bearer wrong-key").send({});

    expect(JSON.stringify(response.body)).not.toContain(API_KEY);
  });
});

describe("POST /career/run — successful dry run", () => {
  it("returns 200 with a dry-run result and never sends WhatsApp", async () => {
    const claudeClient = mockClaudeClient(fullSuccessSequence());
    const app = createApp({
      apiKey: API_KEY,
      jobSource: fakeJobSource([rawJob()]),
      claudeClient,
      idempotencyStore: new InMemoryIdempotencyStore()
    });

    const response = await request(app).post("/career/run").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    expect(response.body.dryRun).toBe(true);
    expect(response.body.status).toBe("COMPLETED");
    expect(response.body.jobsDiscovered).toBe(1);
    expect(response.body.applicationPackagesCreated).toBe(1);
    expect(response.body.whatsappNotificationsSent).toBe(0);
    expect(response.body.runId).toEqual(expect.any(String));
    expect(response.body.startedAt).toEqual(expect.any(String));
    expect(response.body.completedAt).toEqual(expect.any(String));
  });

  it("defaults dryRun=true and sendWhatsApp=false when the request body is empty", async () => {
    const claudeClient = mockClaudeClient(fullSuccessSequence());
    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource([rawJob()]), claudeClient });

    const response = await request(app).post("/career/run").set("Authorization", `Bearer ${API_KEY}`).send();

    expect(response.status).toBe(200);
    expect(response.body.dryRun).toBe(true);
    expect(response.body.whatsappNotificationsSent).toBe(0);
  });
});

describe("POST /career/run — invalid request body", () => {
  it("returns 400 for an out-of-range maxJobs", async () => {
    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource([]) });
    const response = await request(app)
      .post("/career/run")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 999 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request body");
  });
});

describe("POST /career/run — idempotency via Idempotency-Key header", () => {
  it("does not execute the pipeline twice for a duplicate request with the same key", async () => {
    const claudeClient = mockClaudeClient(fullSuccessSequence());
    const searchJobs = vi.fn(async () => [rawJob()]);
    const idempotencyStore = new InMemoryIdempotencyStore();
    const app = createApp({
      apiKey: API_KEY,
      jobSource: fakeJobSource([], searchJobs),
      claudeClient,
      idempotencyStore
    });

    const first = await request(app)
      .post("/career/run")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "dup-key-1")
      .send({});
    const second = await request(app)
      .post("/career/run")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "dup-key-1")
      .send({});

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.runId).toBe(first.body.runId);
    expect(searchJobs).toHaveBeenCalledTimes(1);
  });
});

describe("POST /career/run — safe error responses", () => {
  it("returns a generic 500 without internal error detail when something outside the pipeline's own error handling throws", async () => {
    // A job-source failure is caught INSIDE runCareerPipeline and turned into
    // a normal 200 { status: "FAILED" } result (see the service-level "job
    // provider failure" test) — so to exercise the route's own catch-all we
    // need something that throws from outside that internal try/catch, e.g.
    // a broken idempotency store.
    const brokenIdempotencyStore = {
      get: () => {
        throw new Error("stack trace with secret internal file path C:\\Users\\secret\\config.js");
      },
      set: () => {}
    };
    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource([]), idempotencyStore: brokenIdempotencyStore });

    const response = await request(app)
      .post("/career/run")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "any-key")
      .send({});

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Career orchestration failed unexpectedly");
    expect(JSON.stringify(response.body)).not.toContain("secret");
    expect(JSON.stringify(response.body)).not.toContain("C:\\Users");
  });
});

describe("POST /career/run — sensitive information is never exposed", () => {
  it("never includes resume text, application messages, or the API key in a successful response", async () => {
    const claudeClient = mockClaudeClient(fullSuccessSequence());
    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource([rawJob()]), claudeClient });

    const response = await request(app).post("/career/run").set("Authorization", `Bearer ${API_KEY}`).send({});

    const body = JSON.stringify(response.body);
    expect(body).not.toContain("Full tailored resume text");
    expect(body).not.toContain("Thank you for considering my application");
    expect(body).not.toContain(API_KEY);
  });
});
