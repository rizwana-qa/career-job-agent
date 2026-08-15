import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { matchJobToProfile } from "../../src/agents/jobMatchingAgent.js";
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

const profile = {
  professionalTitle: "Principal Software Quality Engineer | AI, RAG and LLM Testing Specialist",
  coreSkills: "Playwright, API Testing, SQL",
  ragSkills: "RAG platform testing — retrieval accuracy, hallucination detection, vector database validation"
};

function validMatchJson(): string {
  return JSON.stringify({
    matchScore: 80,
    interviewPotential: 65,
    careerGrowth: 60,
    futureAIValue: 85,
    recommendation: "APPLY",
    strongMatches: [{ statement: "Candidate has RAG testing experience.", evidence: "FACT" }],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "Strong alignment with RAG/AI testing requirements."
  });
}

function mockClient(createImpl: (...args: unknown[]) => unknown): Anthropic {
  return {
    messages: { create: vi.fn(createImpl) }
  } as unknown as Anthropic;
}

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("jobMatchingAgent.matchJobToProfile", () => {
  it("returns a validated JobMatch when Claude responds with well-formed JSON", async () => {
    const client = mockClient(async () => textResponse(validMatchJson()));

    const result = await matchJobToProfile(job(), profile, { client });

    expect(result.matchScore).toBe(80);
    expect(result.recommendation).toBe("APPLY");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("throws InvalidClaudeResponseError when the response is not valid JSON, retrying up to the attempt limit first", async () => {
    const client = mockClient(async () => textResponse("Sure, here is my analysis: not JSON at all."));

    await expect(matchJobToProfile(job(), profile, { client })).rejects.toBeInstanceOf(InvalidClaudeResponseError);
    // InvalidClaudeResponseError is now retried (2026-08-15): production
    // evidence showed it can be transient, not just a structural problem.
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  it("throws InvalidClaudeResponseError when there is no text content block, retrying up to the attempt limit first", async () => {
    const client = mockClient(async () => ({ content: [{ type: "tool_use" }] }));

    await expect(matchJobToProfile(job(), profile, { client })).rejects.toBeInstanceOf(InvalidClaudeResponseError);
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  it("succeeds if a retried InvalidClaudeResponseError is followed by a well-formed response", async () => {
    let calls = 0;
    const client = mockClient(async () => {
      calls += 1;
      if (calls === 1) {
        return { content: [{ type: "tool_use" }] }; // no text block -> InvalidClaudeResponseError
      }
      return textResponse(validMatchJson());
    });

    const result = await matchJobToProfile(job(), profile, { client });
    expect(result.matchScore).toBe(80);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("throws ClaudeResponseValidationError when JSON is valid but fails schema", async () => {
    const badJson = JSON.stringify({ ...JSON.parse(validMatchJson()), matchScore: 150 });
    const client = mockClient(async () => textResponse(badJson));

    await expect(matchJobToProfile(job(), profile, { client })).rejects.toBeInstanceOf(ClaudeResponseValidationError);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("retries once on a transient (5xx-like) failure and succeeds on the second attempt", async () => {
    let calls = 0;
    const client = mockClient(async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("Internal Server Error") as Error & { status: number };
        error.status = 503;
        throw error;
      }
      return textResponse(validMatchJson());
    });

    const result = await matchJobToProfile(job(), profile, { client });
    expect(result.matchScore).toBe(80);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 rate-limit response and succeeds on the second attempt", async () => {
    let calls = 0;
    const client = mockClient(async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("Too Many Requests") as Error & { status: number };
        error.status = 429;
        throw error;
      }
      return textResponse(validMatchJson());
    });

    const result = await matchJobToProfile(job(), profile, { client });
    expect(result.matchScore).toBe(80);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry limit and throws ClaudeApiError", async () => {
    const client = mockClient(async () => {
      const error = new Error("Request Timeout") as Error & { name: string };
      error.name = "APIConnectionTimeoutError";
      throw error;
    });

    await expect(matchJobToProfile(job(), profile, { client })).rejects.toBeInstanceOf(ClaudeApiError);
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable error (e.g. 401 auth failure)", async () => {
    const client = mockClient(async () => {
      const error = new Error("Unauthorized") as Error & { status: number };
      error.status = 401;
      throw error;
    });

    await expect(matchJobToProfile(job(), profile, { client })).rejects.toBeInstanceOf(ClaudeApiError);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });
});
