import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { createApp } from "../../src/api/app.js";
import { InMemoryIdempotencyStore } from "../../src/services/careerOrchestrationService.js";
import type { ProcessJobResult } from "../../src/schemas/careerProcessJob.js";

const API_KEY = "test-career-agent-key";

const resumeProfile = {
  professionalTitle: "Principal Software Quality Engineer | AI, RAG and LLM Testing Specialist",
  ragSkills: "RAG platform testing — retrieval accuracy, hallucination detection, vector database validation",
  achievements: "35 to 40% reduction in production defects; 60% test coverage"
};

const masterResume =
  "Rizwana Zahoor — Principal Quality Assurance Engineer, Clustox. Tested a RAG based AI coaching platform. " +
  "Achieved a 35 to 40% reduction in production defects.";

function validJob(overrides: Record<string, unknown> = {}) {
  return {
    jobTitle: "AI Quality Engineer",
    company: "Vantage AI",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: "A sufficiently long job description mentioning quality engineering and testing responsibilities.",
    requirements: ["Testing experience"],
    responsibilities: ["Test the product"],
    skills: ["Testing", "QA"],
    source: "remotive",
    sourceUrl: "https://remotive.com/remote-jobs/qa/1",
    datePosted: "2026-08-10",
    externalJobId: "1",
    ...overrides
  };
}

function validMatch(overrides: Record<string, unknown> = {}) {
  return {
    matchScore: 82,
    interviewPotential: 70,
    careerGrowth: 60,
    futureAIValue: 75,
    recommendation: "APPLY",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason",
    ...overrides
  };
}

function tailoredResumeJson(overrides: Record<string, unknown> = {}): string {
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
    status: "READY_FOR_RESUME_QA",
    ...overrides
  });
}

function evidenceJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: "PASS",
    evidenceScore: 100,
    claimsReviewed: 0,
    supportedClaims: [],
    transferableClaims: [],
    potentiallyUnsupportedClaims: [],
    unsupportedClaims: [],
    unknownClaims: [],
    recommendations: [],
    ...overrides
  });
}

function qaPassJson(overrides: Record<string, unknown> = {}): string {
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
    humanReviewRequired: false,
    ...overrides
  });
}

function qaFailJson(): string {
  return JSON.stringify({
    status: "FAIL",
    overallScore: 40,
    jdAlignmentScore: 40,
    factualAccuracyScore: 20,
    interviewReadinessScore: 40,
    criticalIssues: [
      { severity: "CRITICAL", dimension: "Factual Accuracy", description: "Fabricated certification.", evidence: "No such cert in Master Resume." }
    ],
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
    humanReviewRequired: true
  });
}

function applicationMessageJson(): string {
  return JSON.stringify({ applicationMessage: "Thank you for considering my application — never expected in an API response." });
}

function fullSuccessSequence(): string[] {
  return [tailoredResumeJson(), evidenceJson(), qaPassJson(), applicationMessageJson()];
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
    resumeProfile,
    masterResume,
    jobPreferences: {},
    ...overrides
  };
}

function validRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "1",
    resumeProcessing: true,
    jobData: { job: validJob(), match: validMatch() },
    ...overrides
  };
}

describe("POST /career/process-job — authentication", () => {
  it("returns 401 with 'Missing API key' when no Authorization header is sent", async () => {
    const app = createApp(baseAppDeps());
    const response = await request(app).post("/career/process-job").send(validRequestBody());

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Missing API key");
  });

  it("returns 401 with 'Invalid API key' for a wrong bearer token", async () => {
    const app = createApp(baseAppDeps());
    const response = await request(app)
      .post("/career/process-job")
      .set("Authorization", "Bearer wrong-key")
      .send(validRequestBody());

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid API key");
  });
});

describe("POST /career/process-job — valid job (successful processing)", () => {
  it("returns COMPLETED with a created application package", async () => {
    const claudeClient = queueClaudeClient(fullSuccessSequence());
    const app = createApp(baseAppDeps({ claudeClient }));

    const response = await request(app)
      .post("/career/process-job")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send(validRequestBody());

    expect(response.status).toBe(200);
    const body: ProcessJobResult = response.body;
    expect(body.status).toBe("COMPLETED");
    expect(body.jobId).toBe("1");
    expect(body.company).toBe("Vantage AI");
    expect(body.jobTitle).toBe("AI Quality Engineer");
    expect(body.resumeQAStatus).toBe("PASS");
    expect(body.resumeQAOverallScore).toBe(85);
    expect(body.applicationPackageCreated).toBe(true);
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(4);
  });
});

describe("POST /career/process-job — invalid job", () => {
  it("returns 400 when jobId does not match jobData.job", async () => {
    const claudeClient = queueClaudeClient([]);
    const app = createApp(baseAppDeps({ claudeClient }));

    const response = await request(app)
      .post("/career/process-job")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send(validRequestBody({ jobId: "does-not-match" }));

    expect(response.status).toBe(400);
    expect(claudeClient.messages.create).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed request body", async () => {
    const app = createApp(baseAppDeps());
    const response = await request(app)
      .post("/career/process-job")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ jobId: "1" }); // missing jobData and resumeProcessing

    expect(response.status).toBe(400);
  });
});

describe("POST /career/process-job — stage failures return FAILED", () => {
  it("returns FAILED when Resume Tailoring throws", async () => {
    const claudeClient = queueClaudeClient([nonRetryableFailure]);
    const app = createApp(baseAppDeps({ claudeClient }));

    const response = await request(app)
      .post("/career/process-job")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send(validRequestBody());

    expect(response.status).toBe(200);
    const body: ProcessJobResult = response.body;
    expect(body.status).toBe("FAILED");
    expect(body.resumeQAStatus).toBe("NOT_REACHED");
    expect(body.applicationPackageCreated).toBe(false);
  });

  it("returns FAILED when Evidence Guard throws", async () => {
    const claudeClient = queueClaudeClient([tailoredResumeJson(), nonRetryableFailure]);
    const app = createApp(baseAppDeps({ claudeClient }));

    const response = await request(app)
      .post("/career/process-job")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send(validRequestBody());

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("FAILED");
  });

  it("returns FAILED when the Resume QA stage itself throws", async () => {
    const claudeClient = queueClaudeClient([tailoredResumeJson(), evidenceJson(), nonRetryableFailure]);
    const app = createApp(baseAppDeps({ claudeClient }));

    const response = await request(app)
      .post("/career/process-job")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send(validRequestBody());

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("FAILED");
  });

  it("returns FAILED when Application Package generation throws", async () => {
    const claudeClient = queueClaudeClient([tailoredResumeJson(), evidenceJson(), qaPassJson(), nonRetryableFailure]);
    const app = createApp(baseAppDeps({ claudeClient }));

    const response = await request(app)
      .post("/career/process-job")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send(validRequestBody());

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("FAILED");
  });
});

describe("POST /career/process-job — Resume QA does not pass (no exception)", () => {
  it("returns PARTIAL, not FAILED, when Resume QA verdict is FAIL — this is a normal outcome, not a crash", async () => {
    const claudeClient = queueClaudeClient([tailoredResumeJson(), evidenceJson(), qaFailJson()]);
    const app = createApp(baseAppDeps({ claudeClient }));

    const response = await request(app)
      .post("/career/process-job")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send(validRequestBody());

    expect(response.status).toBe(200);
    const body: ProcessJobResult = response.body;
    expect(body.status).toBe("PARTIAL");
    expect(body.resumeQAStatus).toBe("FAIL");
    expect(body.applicationPackageCreated).toBe(false);
    // Never returned 200 COMPLETED for this — the whole point of section 9.
    expect(body.status).not.toBe("COMPLETED");
  });
});

describe("POST /career/process-job — idempotency", () => {
  it("returns the cached result and never re-calls Claude for a repeated Idempotency-Key", async () => {
    const claudeClient = queueClaudeClient(fullSuccessSequence());
    const idempotencyStore = new InMemoryIdempotencyStore<ProcessJobResult>();
    const app = createApp(baseAppDeps({ claudeClient, idempotencyStore }));

    const first = await request(app)
      .post("/career/process-job")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "job-1-opportunity")
      .send(validRequestBody());
    const second = await request(app)
      .post("/career/process-job")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "job-1-opportunity")
      .send(validRequestBody());

    expect(first.body).toEqual(second.body);
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(4);
  });
});

describe("POST /career/process-job — safe response", () => {
  it("never includes tailored resume text, master resume content, career profile, or the API key", async () => {
    const claudeClient = queueClaudeClient(fullSuccessSequence());
    const app = createApp(baseAppDeps({ claudeClient }));

    const response = await request(app)
      .post("/career/process-job")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send(validRequestBody());

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("Full tailored resume text");
    expect(serialized).not.toContain(masterResume);
    expect(serialized).not.toContain(resumeProfile.achievements);
    expect(serialized).not.toContain("Thank you for considering my application");
    expect(serialized).not.toContain(API_KEY);
  });
});
