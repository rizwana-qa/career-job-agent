import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { createApp } from "../../src/api/app.js";
import type { JobSource, RawProviderJob } from "../../src/jobSources/jobSource.js";
import { normalizeRemotiveJob } from "../../src/jobSources/remotiveNormalizer.js";
import type { DiscoverMatchResult } from "../../src/schemas/careerDiscoverMatch.js";

const API_KEY = "test-career-agent-key";

const matchingProfile = {
  professionalTitle: "Principal Software Quality Engineer",
  coreSkills: "Playwright, API Testing, SQL"
};

function rawJob(overrides: Record<string, unknown> = {}): RawProviderJob {
  return {
    jobTitle: "Principal QA Engineer",
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
      return raw; // fixtures are already Job-schema-shaped
    }
  };
}

function matchJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    matchScore: 80,
    interviewPotential: 65,
    careerGrowth: 60,
    futureAIValue: 55,
    recommendation: "APPLY",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason",
    careerRelevanceScore: 85,
    whySelected: "Strong alignment with the target career family.",
    ...overrides
  });
}

type QueueItem = string;

function queueClaudeClient(items: QueueItem[]): Anthropic {
  let index = 0;
  const create = vi.fn(async () => {
    const text = items[index];
    if (text === undefined) {
      throw new Error(`queueClaudeClient: no mock response queued for call #${index + 1}`);
    }
    index += 1;
    return { content: [{ type: "text", text }] };
  });
  return { messages: { create } } as unknown as Anthropic;
}

/**
 * Phase 8.3.2 regression suite — reproduces the production report
 * (jobsMatched > 0 but topJobs = []) as CASE B (a legitimate, correct
 * outcome of the unweakened gate) versus CASE A (one job genuinely
 * qualifying), and separately confirms sourceUrl survives end to end
 * (CASE C/D/E) so "no job details visible" is verified as a consequence of
 * an empty topJobs array, not a separate URL-dropping bug.
 */
describe("POST /career/discover-match — topJobs / sourceUrl regression (Phase 8.3.2)", () => {
  it("CASE A: 2 matched jobs, 1 passes the final gate — topJobs has exactly 1 entry with sourceUrl present", async () => {
    const jobs = [
      rawJob({ externalJobId: "qualifies", sourceUrl: "https://remotive.com/qualifies", jobTitle: "Principal QA Engineer" }),
      rawJob({ externalJobId: "below-threshold", sourceUrl: "https://remotive.com/below-threshold", jobTitle: "Staff QA Engineer" })
    ];
    const claudeClient = queueClaudeClient([
      matchJson({ careerRelevanceScore: 85, matchScore: 80, recommendation: "APPLY" }), // passes
      matchJson({ careerRelevanceScore: 50, matchScore: 80, recommendation: "CONSIDER" }) // fails: careerRelevanceScore < 70
    ]);

    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource(jobs), claudeClient, profile: matchingProfile, jobDiscoveryPreferences: {} });
    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.jobsMatched).toBe(2);
    expect(body.topJobs).toHaveLength(1);
    expect(body.topJobs[0].sourceUrl).toBe("https://remotive.com/qualifies");
    expect(body.topJobs[0].sourceUrl.length).toBeGreaterThan(0);
  });

  it("CASE B: 2 matched jobs, 0 pass the final gate — topJobs stays empty, jobsMatched still reports 2 (the gate is not weakened to force a result)", async () => {
    const jobs = [
      rawJob({ externalJobId: "low-relevance", sourceUrl: "https://remotive.com/low-relevance" }),
      rawJob({ externalJobId: "rejected", sourceUrl: "https://remotive.com/rejected" })
    ];
    const claudeClient = queueClaudeClient([
      matchJson({ careerRelevanceScore: 60, matchScore: 80, recommendation: "APPLY" }), // fails: careerRelevanceScore < 70
      matchJson({ careerRelevanceScore: 90, matchScore: 90, recommendation: "REJECT" }) // fails: REJECT is never shortlisted, regardless of scores
    ]);

    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource(jobs), claudeClient, profile: matchingProfile, jobDiscoveryPreferences: {} });
    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.jobsMatched).toBe(2);
    expect(body.topJobs).toEqual([]);
    // Diagnostic counts remain visible even when topJobs is empty.
    expect(body.relevanceFiltered).toBe(0);
    expect(typeof body.jobsMatched).toBe("number");
  });

  it("CASE B (missing careerRelevanceScore): a matched job whose Claude response omits careerRelevanceScore entirely still fails the gate, exactly like a low score — not silently admitted", async () => {
    const jobs = [rawJob({ externalJobId: "no-relevance-score" })];
    // careerRelevanceScore intentionally absent from the JSON — JobMatchSchema
    // allows this (optional, for backward compatibility with /career/run and
    // /jobs/analyze fixtures that predate Phase 8.3) but the gate must still
    // treat "missing" the same as "not confirmed >= 70", never as a pass.
    const claudeClient = queueClaudeClient([
      JSON.stringify({
        matchScore: 90,
        interviewPotential: 80,
        careerGrowth: 70,
        futureAIValue: 60,
        recommendation: "APPLY",
        strongMatches: [],
        transferableSkills: [],
        gaps: [],
        risks: [],
        reason: "test fixture reason"
        // careerRelevanceScore and whySelected both omitted.
      })
    ]);

    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource(jobs), claudeClient, profile: matchingProfile, jobDiscoveryPreferences: {} });
    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.jobsMatched).toBe(1);
    expect(body.matchingFailures).toBe(0); // schema validation succeeded — this is not a Claude/matching failure
    expect(body.topJobs).toEqual([]); // but the gate still correctly excludes it
  });

  it("CASE C: a qualifying Remotive job's sourceUrl in topJobs is the exact original Remotive URL, never reconstructed", async () => {
    const originalRemotiveUrl = "https://remotive.com/remote-jobs/qa/ai-quality-engineer-77421";
    const rawRemotiveJob = {
      id: 77421,
      title: "AI Quality Engineer",
      company_name: "Vantage AI",
      url: originalRemotiveUrl,
      candidate_required_location: "Worldwide",
      publication_date: "2026-08-10T00:00:00",
      description: "<p>We are hiring an AI Quality Engineer to own test strategy for our LLM-powered platform.</p>",
      job_type: "full_time",
      tags: ["QA", "AI", "Testing"]
    };
    const normalized = normalizeRemotiveJob(rawRemotiveJob) as Record<string, unknown>;
    expect(normalized.sourceUrl).toBe(originalRemotiveUrl); // normalize() itself never rewrites the URL

    const remotiveShapedSource: JobSource = {
      name: "remotive",
      searchJobs: vi.fn(async () => [rawRemotiveJob]),
      async getJob() {
        return null;
      },
      normalize: (raw: RawProviderJob) => normalizeRemotiveJob(raw)
    };
    const claudeClient = queueClaudeClient([matchJson({ careerRelevanceScore: 90, matchScore: 88, recommendation: "APPLY" })]);

    const app = createApp({ apiKey: API_KEY, jobSource: remotiveShapedSource, claudeClient, profile: matchingProfile, jobDiscoveryPreferences: {} });
    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.topJobs).toHaveLength(1);
    expect(body.topJobs[0].sourceUrl).toBe(originalRemotiveUrl);
    expect(body.topJobs[0].source).toBe("remotive");
  });

  it("CASE D: a qualifying topJob contains every required field from the Phase 8.3.2 response contract", async () => {
    const jobs = [rawJob({ externalJobId: "full-shape" })];
    const claudeClient = queueClaudeClient([matchJson({ careerRelevanceScore: 90, matchScore: 88, recommendation: "APPLY" })]);

    const app = createApp({ apiKey: API_KEY, jobSource: fakeJobSource(jobs), claudeClient, profile: matchingProfile, jobDiscoveryPreferences: {} });
    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    const topJob = response.body.topJobs[0];
    for (const field of [
      "jobId",
      "jobTitle",
      "company",
      "location",
      "country",
      "remoteStatus",
      "employmentType",
      "source",
      "sourceUrl",
      "datePosted",
      "careerRelevanceScore",
      "matchScore",
      "interviewPotential",
      "careerGrowth",
      "futureAIValue",
      "recommendation",
      "whySelected"
    ]) {
      expect(topJob).toHaveProperty(field);
      expect(topJob[field]).not.toBeUndefined();
    }
    // Never the full job description.
    expect(topJob).not.toHaveProperty("jobDescription");
  });

  it("CASE E: a raw job missing sourceUrl is dropped entirely — no fabricated URL ever appears", async () => {
    const { sourceUrl, ...jobWithoutUrl } = rawJob({ externalJobId: "no-url" });
    void sourceUrl;
    const claudeClient = queueClaudeClient([]); // never reached — the job fails schema validation before matching

    const app = createApp({
      apiKey: API_KEY,
      jobSource: fakeJobSource([jobWithoutUrl as RawProviderJob]),
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });
    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.jobsAfterFiltering).toBe(0); // rejected at JobSchema validation, never reached the deterministic filter
    expect(body.topJobs).toEqual([]);
    expect(claudeClient.messages.create).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("undefined");
  });
});
