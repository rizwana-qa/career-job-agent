import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { reviewTailoredResume } from "../../src/agents/resumeQAAgent.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";
import { TailoredResumeSchema, type TailoredResume } from "../../src/schemas/tailoredResume.js";
import { ResumeEvidenceReportSchema, type ResumeEvidenceReport } from "../../src/schemas/resumeEvidence.js";
import { loadJobFixture } from "../helpers/fixtures.js";
import {
  ClaudeApiError,
  ClaudeResponseValidationError,
  InvalidClaudeResponseError
} from "../../src/utils/errors.js";

function job(): Job {
  return JobSchema.parse(loadJobFixture("04-ai-quality-engineer.json"));
}

const careerProfile = {
  professionalTitle: "Principal Software Quality Engineer | AI, RAG and LLM Testing Specialist",
  ragSkills: "RAG platform testing — retrieval accuracy, hallucination detection"
};

const masterResume = "Principal QA Engineer at Clustox. Tested a RAG based AI coaching platform.";

function tailoredResume(): TailoredResume {
  return TailoredResumeSchema.parse({
    jobId: "job-1",
    targetRole: "AI Quality Engineer",
    targetCompany: "Vantage AI",
    professionalSummary: "Principal QA leader with RAG testing experience.",
    coreSkills: ["RAG Testing"],
    experience: [{ title: "Principal QA Engineer", company: "Clustox", dates: "2022-Present", bullets: ["Tested RAG platform."] }],
    education: [],
    certifications: [],
    matchedRequirements: [],
    transferableRequirements: [],
    gaps: [],
    keywordsAdded: [],
    changesMade: [],
    claimsRequiringVerification: [],
    tailoredResume: "Full resume text.",
    status: "READY_FOR_RESUME_QA"
  });
}

function evidenceGuardResult(): ResumeEvidenceReport {
  return ResumeEvidenceReportSchema.parse({
    status: "PASS",
    evidenceScore: 100,
    claimsReviewed: 1,
    supportedClaims: [{ claim: "Tested RAG platform.", sourceLocation: "professionalSummary", evidence: "Confirmed.", classification: "SUPPORTED" }],
    transferableClaims: [],
    potentiallyUnsupportedClaims: [],
    unsupportedClaims: [],
    unknownClaims: [],
    recommendations: []
  });
}

function validQAReportJson(): string {
  return JSON.stringify({
    status: "PASS",
    overallScore: 85,
    jdAlignmentScore: 80,
    factualAccuracyScore: 95,
    interviewReadinessScore: 82,
    criticalIssues: [],
    highIssues: [],
    mediumIssues: [],
    lowIssues: [],
    strengths: ["Strong RAG narrative."],
    mandatoryRequirements: [],
    preferredRequirements: [],
    supportedKeywords: ["RAG Testing"],
    missingImportantKeywords: [],
    unsupportedKeywords: [],
    overusedKeywords: [],
    unsupportedClaims: [],
    transferableClaims: [],
    recommendations: [],
    humanReviewRequired: false
  });
}

function mockClient(createImpl: (...args: unknown[]) => unknown): Anthropic {
  return { messages: { create: vi.fn(createImpl) } } as unknown as Anthropic;
}

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("resumeQAAgent.reviewTailoredResume", () => {
  it("returns a validated ResumeQAReport for a well-formed Claude response", async () => {
    const client = mockClient(async () => textResponse(validQAReportJson()));

    const result = await reviewTailoredResume(job(), careerProfile, masterResume, tailoredResume(), evidenceGuardResult(), {
      client
    });

    expect(result.status).toBe("PASS");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("throws InvalidClaudeResponseError for non-JSON output, retrying up to the attempt limit first", async () => {
    const client = mockClient(async () => textResponse("Here is my review, in prose."));

    await expect(
      reviewTailoredResume(job(), careerProfile, masterResume, tailoredResume(), evidenceGuardResult(), { client })
    ).rejects.toBeInstanceOf(InvalidClaudeResponseError);
    // InvalidClaudeResponseError is now retried (2026-08-15): production
    // evidence showed it can be transient, not just a structural problem.
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  it("throws ClaudeResponseValidationError for a schema-invalid response", async () => {
    const badJson = JSON.stringify({ ...JSON.parse(validQAReportJson()), status: "MAYBE" });
    const client = mockClient(async () => textResponse(badJson));

    await expect(
      reviewTailoredResume(job(), careerProfile, masterResume, tailoredResume(), evidenceGuardResult(), { client })
    ).rejects.toBeInstanceOf(ClaudeResponseValidationError);
  });

  it("retries once on a transient failure and succeeds on the second attempt", async () => {
    let calls = 0;
    const client = mockClient(async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("Service Unavailable") as Error & { status: number };
        error.status = 503;
        throw error;
      }
      return textResponse(validQAReportJson());
    });

    const result = await reviewTailoredResume(job(), careerProfile, masterResume, tailoredResume(), evidenceGuardResult(), {
      client
    });
    expect(result.status).toBe("PASS");
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry limit and throws ClaudeApiError", async () => {
    const client = mockClient(async () => {
      const error = new Error("Request Timeout") as Error & { name: string };
      error.name = "APIConnectionTimeoutError";
      throw error;
    });

    await expect(
      reviewTailoredResume(job(), careerProfile, masterResume, tailoredResume(), evidenceGuardResult(), { client })
    ).rejects.toBeInstanceOf(ClaudeApiError);
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable error (401 auth failure)", async () => {
    const client = mockClient(async () => {
      const error = new Error("Unauthorized") as Error & { status: number };
      error.status = 401;
      throw error;
    });

    await expect(
      reviewTailoredResume(job(), careerProfile, masterResume, tailoredResume(), evidenceGuardResult(), { client })
    ).rejects.toBeInstanceOf(ClaudeApiError);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });
});
