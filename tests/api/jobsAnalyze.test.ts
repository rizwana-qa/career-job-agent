import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { createApp } from "../../src/api/app.js";
import { loadJobFixture } from "../helpers/fixtures.js";

// Every test in this file that needs a Claude client injects its own mock —
// none relies on the route's real createClaudeClient() fallback succeeding.
// Mocked here so the "Claude is not configured" test stays correct
// regardless of whether a real CLAUDE_API_KEY happens to be set locally
// (e.g. in .env for tests/integration/careerRun.manual.ts).
vi.mock("../../src/services/claudeClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/claudeClient.js")>();
  return {
    ...actual,
    createClaudeClient: () => {
      throw new Error("CLAUDE_API_KEY is not configured");
    }
  };
});

const profile = {
  professionalTitle: "Principal Software Quality Engineer",
  coreSkills: "Playwright, API Testing, SQL"
};

function validMatchJson(): string {
  return JSON.stringify({
    matchScore: 78,
    interviewPotential: 62,
    careerGrowth: 58,
    futureAIValue: 70,
    recommendation: "CONSIDER",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason"
  });
}

function mockClient(): Anthropic {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: validMatchJson() }] }));
  return { messages: { create } } as unknown as Anthropic;
}

describe("POST /jobs/analyze", () => {
  it("returns a scored top-jobs list for a valid request", async () => {
    const app = createApp({ claudeClient: mockClient(), profile });

    const response = await request(app)
      .post("/jobs/analyze")
      .send({ jobs: [loadJobFixture("01-principal-qa-engineer.json")] });

    expect(response.status).toBe(200);
    expect(response.body.jobsReceived).toBe(1);
    expect(response.body.jobsEligible).toBe(1);
    expect(response.body.jobsAnalyzed).toBe(1);
    expect(response.body.topJobs).toHaveLength(1);
    expect(response.body.topJobs[0].matchScoreLabel).toBe("Estimated Application Match Score");
  });

  it("returns a clean empty result for an empty jobs array", async () => {
    const app = createApp({ claudeClient: mockClient(), profile });

    const response = await request(app).post("/jobs/analyze").send({ jobs: [] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ jobsReceived: 0, jobsEligible: 0, jobsAnalyzed: 0, topJobs: [] });
  });

  it("returns 400 when the request body is missing the jobs field", async () => {
    const app = createApp({ claudeClient: mockClient(), profile });

    const response = await request(app).post("/jobs/analyze").send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request body");
    expect(Array.isArray(response.body.details)).toBe(true);
  });

  it("returns 400 when jobs is not an array", async () => {
    const app = createApp({ claudeClient: mockClient(), profile });

    const response = await request(app).post("/jobs/analyze").send({ jobs: "not-an-array" });

    expect(response.status).toBe(400);
  });

  it("never exposes internal error detail or profile content in an error response", async () => {
    const app = createApp({ claudeClient: mockClient(), profile });
    const response = await request(app).post("/jobs/analyze").send({});

    const body = JSON.stringify(response.body);
    expect(body).not.toContain("Principal Software Quality Engineer");
  });

  it("returns 200 for an empty jobs array even when Claude is not configured at all", async () => {
    const app = createApp({ profile });

    const response = await request(app).post("/jobs/analyze").send({ jobs: [] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ jobsReceived: 0, jobsEligible: 0, jobsAnalyzed: 0, topJobs: [] });
  });

  it("applies the real profile/job_preferences.md country defaults when no override is supplied", async () => {
    // 07-senior-sdet.json is ONSITE in the United States, which is not in
    // job_preferences.md's active Target Countries list (Pakistan, UAE,
    // Remote/Global) — it should be filtered out using the real file, with
    // no filterOptions/jobPreferences dependency injected at all.
    const app = createApp({ profile });

    const response = await request(app)
      .post("/jobs/analyze")
      .send({ jobs: [loadJobFixture("07-senior-sdet.json")] });

    expect(response.status).toBe(200);
    expect(response.body.jobsEligible).toBe(0);
  });

  it("lets a caller-supplied filterOptions.allowedCountries override the job_preferences.md default", async () => {
    const app = createApp({
      claudeClient: mockClient(),
      profile,
      filterOptions: { allowedCountries: ["United States"] }
    });

    const response = await request(app)
      .post("/jobs/analyze")
      .send({ jobs: [loadJobFixture("07-senior-sdet.json")] });

    expect(response.status).toBe(200);
    expect(response.body.jobsEligible).toBe(1);
    expect(response.body.jobsAnalyzed).toBe(1);
  });

  it("returns 503 when no Claude client is injected and CLAUDE_API_KEY is not configured", async () => {
    // This environment has no CLAUDE_API_KEY set (verified during Phase 2 review) —
    // this exercises the real "not configured" path without a live API key.
    const app = createApp({ profile });

    const response = await request(app)
      .post("/jobs/analyze")
      .send({ jobs: [loadJobFixture("01-principal-qa-engineer.json")] });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("Claude API is not configured");
  });
});
