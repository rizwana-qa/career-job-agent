import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { tailorResume } from "../../src/agents/resumeTailoringAgent.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";
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
  ragSkills: "RAG platform testing — retrieval accuracy, hallucination detection, vector database validation"
};

const masterResume = "Principal QA Engineer at Clustox. Tested a RAG based AI coaching platform.";

function validTailoredResumeJson(): string {
  return JSON.stringify({
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

function mockClient(createImpl: (...args: unknown[]) => unknown): Anthropic {
  return { messages: { create: vi.fn(createImpl) } } as unknown as Anthropic;
}

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("resumeTailoringAgent.tailorResume", () => {
  it("returns a validated TailoredResume when Claude responds with well-formed JSON", async () => {
    const client = mockClient(async () => textResponse(validTailoredResumeJson()));

    const result = await tailorResume(job(), careerProfile, masterResume, undefined, { client });

    expect(result.status).toBe("READY_FOR_RESUME_QA");
    expect(result.tailoredResume).toBe("Full resume text.");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("throws InvalidClaudeResponseError when the response is not valid JSON", async () => {
    const client = mockClient(async () => textResponse("Here's your tailored resume: <not json>"));

    await expect(tailorResume(job(), careerProfile, masterResume, undefined, { client })).rejects.toBeInstanceOf(
      InvalidClaudeResponseError
    );
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("throws ClaudeResponseValidationError when JSON is valid but fails schema (empty tailoredResume)", async () => {
    const badJson = JSON.stringify({ ...JSON.parse(validTailoredResumeJson()), tailoredResume: "" });
    const client = mockClient(async () => textResponse(badJson));

    await expect(tailorResume(job(), careerProfile, masterResume, undefined, { client })).rejects.toBeInstanceOf(
      ClaudeResponseValidationError
    );
    expect(client.messages.create).toHaveBeenCalledTimes(1);
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
      return textResponse(validTailoredResumeJson());
    });

    const result = await tailorResume(job(), careerProfile, masterResume, undefined, { client });
    expect(result.status).toBe("READY_FOR_RESUME_QA");
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry limit and throws ClaudeApiError", async () => {
    const client = mockClient(async () => {
      const error = new Error("Request Timeout") as Error & { name: string };
      error.name = "APIConnectionTimeoutError";
      throw error;
    });

    await expect(tailorResume(job(), careerProfile, masterResume, undefined, { client })).rejects.toBeInstanceOf(
      ClaudeApiError
    );
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable error (401 auth failure)", async () => {
    const client = mockClient(async () => {
      const error = new Error("Unauthorized") as Error & { status: number };
      error.status = 401;
      throw error;
    });

    await expect(tailorResume(job(), careerProfile, masterResume, undefined, { client })).rejects.toBeInstanceOf(
      ClaudeApiError
    );
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("accepts an optional jobPreferences argument without changing the response shape", async () => {
    const client = mockClient(async () => textResponse(validTailoredResumeJson()));
    const result = await tailorResume(job(), careerProfile, masterResume, { targetRoles: "AI Quality Engineering" }, {
      client
    });
    expect(result.status).toBe("READY_FOR_RESUME_QA");
  });
});
