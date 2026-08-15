import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { createApp } from "../../src/api/app.js";
import type { JobSource, RawProviderJob } from "../../src/jobSources/jobSource.js";
import { JobSourceUnavailableError } from "../../src/utils/errors.js";

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
    async searchJobs() {
      return jobs;
    },
    async getJob() {
      return null;
    },
    normalize(raw: RawProviderJob) {
      return raw;
    }
  };
}

function validMatchJson(): string {
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

function mockClient(): Anthropic {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: validMatchJson() }] }));
  return { messages: { create } } as unknown as Anthropic;
}

describe("POST /jobs/discover", () => {
  it("returns a discovered, matched, ranked job list for a valid request", async () => {
    const app = createApp({ jobSource: fakeJobSource([rawJob()]), claudeClient: mockClient(), profile, jobDiscoveryPreferences: {} });

    const response = await request(app).post("/jobs/discover").send({ criteria: {} });

    expect(response.status).toBe(200);
    expect(response.body.jobsFound).toBe(1);
    expect(response.body.jobsValid).toBe(1);
    expect(response.body.jobsAfterFiltering).toBe(1);
    expect(response.body.jobs).toHaveLength(1);
  });

  it("accepts a request body with no criteria field at all", async () => {
    const app = createApp({ jobSource: fakeJobSource([]), claudeClient: mockClient(), profile, jobDiscoveryPreferences: {} });

    const response = await request(app).post("/jobs/discover").send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ jobsFound: 0, jobsValid: 0, jobsAfterFiltering: 0, jobs: [] });
  });

  it("returns 400 for an invalid criteria object", async () => {
    const app = createApp({ jobSource: fakeJobSource([]), claudeClient: mockClient(), profile, jobDiscoveryPreferences: {} });

    const response = await request(app)
      .post("/jobs/discover")
      .send({ criteria: { minimumSalary: -50 } });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid search criteria");
  });

  it("returns 200 for an empty discovery result even when Claude is not configured", async () => {
    const app = createApp({ jobSource: fakeJobSource([]), profile, jobDiscoveryPreferences: {} });

    const response = await request(app).post("/jobs/discover").send({ criteria: {} });

    expect(response.status).toBe(200);
  });

  it("returns 503 when eligible jobs exist but Claude is not configured", async () => {
    const app = createApp({ jobSource: fakeJobSource([rawJob()]), profile, jobDiscoveryPreferences: {} });

    const response = await request(app).post("/jobs/discover").send({ criteria: {} });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("Claude API is not configured");
  });

  it("returns 502 when the job source itself fails", async () => {
    const failingSource: JobSource = {
      name: "failing-source",
      async searchJobs() {
        throw new JobSourceUnavailableError("simulated outage");
      },
      async getJob() {
        return null;
      },
      normalize(raw) {
        return raw;
      }
    };
    const app = createApp({ jobSource: failingSource, claudeClient: mockClient(), profile, jobDiscoveryPreferences: {} });

    const response = await request(app).post("/jobs/discover").send({ criteria: {} });

    expect(response.status).toBe(502);
    expect(response.body.error).toBe("Job source is currently unavailable");
  });

  it("never exposes internal error detail in an error response", async () => {
    const app = createApp({ jobSource: fakeJobSource([]), claudeClient: mockClient(), profile, jobDiscoveryPreferences: {} });
    const response = await request(app)
      .post("/jobs/discover")
      .send({ criteria: { minimumSalary: -1 } });

    const body = JSON.stringify(response.body);
    expect(body).not.toContain("Principal Software Quality Engineer");
  });
});
