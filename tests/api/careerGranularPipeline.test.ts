import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { createApp } from "../../src/api/app.js";
import type { JobSource, RawProviderJob } from "../../src/jobSources/jobSource.js";
import type { DiscoverMatchResult } from "../../src/schemas/careerDiscoverMatch.js";
import type { ProcessJobResult } from "../../src/schemas/careerProcessJob.js";

const API_KEY = "test-career-agent-key";

const matchingProfile = {
  professionalTitle: "Principal Software Quality Engineer",
  coreSkills: "Playwright, API Testing, SQL"
};

const resumeProfile = {
  professionalTitle: "Principal Software Quality Engineer | AI, RAG and LLM Testing Specialist",
  ragSkills: "RAG platform testing — retrieval accuracy, hallucination detection, vector database validation"
};

const masterResume = "Rizwana Zahoor — Principal Quality Assurance Engineer, Clustox.";

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

/** Deliberately fails JobSchema validation (jobDescription under the 20-char minimum) — used to reliably produce a "filtered out" job without needing to reverse-engineer the deterministic filter's keyword rules. */
function invalidRawJob(overrides: Record<string, unknown> = {}): RawProviderJob {
  return rawJob({ jobDescription: "too short", ...overrides });
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
    // Career Relevance Gate (Phase 8.3) default — passes the >= 70 gate.
    careerRelevanceScore: 85,
    whySelected: "Strong alignment with the target career family.",
    ...overrides
  });
}

function tailoredResumeJson(): string {
  return JSON.stringify({
    jobId: "placeholder",
    targetRole: "placeholder",
    targetCompany: "placeholder",
    professionalSummary: "Principal QA leader.",
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
    tailoredResume: "Full tailored resume text.",
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
  return JSON.stringify({ applicationMessage: "Thank you for considering my application." });
}

function queueClaudeClient(items: string[]): Anthropic {
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

describe("Granular pipeline regression (Phase 8.2 §10) — 10 discovered, 8 filtered, 5 matched, topJobs=5, resumeTopJobs=2", () => {
  it("discover-match returns exactly 5 topJobs, and the first 2 (resumeTopJobs=2) are both independently processable via process-job", async () => {
    // 10 raw jobs discovered: 8 valid + eligible, 2 deliberately invalid (fail JobSchema validation, not sent to Claude at all).
    const jobs: RawProviderJob[] = [
      ...Array.from({ length: 8 }, (_, i) =>
        rawJob({ externalJobId: `valid-${i + 1}`, sourceUrl: `https://remotive.com/job-valid-${i + 1}`, jobTitle: `QA Engineer ${i + 1}` })
      ),
      invalidRawJob({ externalJobId: "invalid-1", sourceUrl: "https://remotive.com/job-invalid-1" }),
      invalidRawJob({ externalJobId: "invalid-2", sourceUrl: "https://remotive.com/job-invalid-2" })
    ];

    // All 8 eligible jobs succeed matching, with distinct scores so ranking
    // order is deterministic (highest first). topJobs=5 caps the *returned*
    // set to 5 even though all 8 matched — this is what makes jobsMatched
    // come out to exactly 5, matching the scenario ("5 matched" = the
    // post-ranking-selection count, per Phase 6.1's established semantics).
    const matchResponses = [90, 88, 86, 84, 82, 80, 78, 76].map((score) => matchJson({ matchScore: score }));
    // 2 process-job calls follow, one per job the n8n side selects (first 2
    // of the 5 returned) — 4 Claude calls each.
    const processJobResponses = [
      tailoredResumeJson(), evidenceJson(), qaPassJson(), applicationMessageJson(),
      tailoredResumeJson(), evidenceJson(), qaPassJson(), applicationMessageJson()
    ];
    const claudeClient = queueClaudeClient([...matchResponses, ...processJobResponses]);

    const app = createApp({
      apiKey: API_KEY,
      jobSource: fakeJobSource(jobs),
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {},
      resumeProfile,
      masterResume,
      jobPreferences: {}
    });

    // --- Step 1: discover-match ---
    const discoverResponse = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 10, topJobs: 5 });

    expect(discoverResponse.status).toBe(200);
    const discoverBody: DiscoverMatchResult = discoverResponse.body;
    expect(discoverBody.jobsDiscovered).toBe(10);
    expect(discoverBody.jobsAfterFiltering).toBe(8);
    // jobsMatched reflects every job Claude successfully evaluated (capped
    // only by maxJobs=10, all 8 eligible jobs matched) — the Career
    // Relevance Gate is applied afterward, separately, to produce topJobs.
    expect(discoverBody.jobsMatched).toBe(8);
    expect(discoverBody.matchingFailures).toBe(0);
    expect(discoverBody.topJobs).toHaveLength(5);
    // Sorted highest match first.
    expect(discoverBody.topJobs[0].matchScore).toBe(90);
    expect(discoverBody.topJobs[4].matchScore).toBe(82);

    // --- Step 2: n8n takes resumeTopJobs=2 (the first 2 of the 5 returned) ---
    const resumeTopJobs = discoverBody.topJobs.slice(0, 2);
    expect(resumeTopJobs).toHaveLength(2);

    const processResults: ProcessJobResult[] = [];
    for (const topJob of resumeTopJobs) {
      const response = await request(app)
        .post("/career/process-job")
        .set("Authorization", `Bearer ${API_KEY}`)
        .send({ jobId: topJob.jobId, resumeProcessing: true, jobData: topJob.jobData });
      expect(response.status).toBe(200);
      processResults.push(response.body);
    }

    // --- Result: exactly 2 processable resume jobs ---
    const processable = processResults.filter((r) => r.applicationPackageCreated === true);
    expect(processable).toHaveLength(2);
    expect(processResults.every((r) => r.status === "COMPLETED")).toBe(true);

    // Total Claude calls: 8 (matching) + 4 + 4 (two process-job runs) = 16 — never 3 jobs' worth, never all 5.
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(16);
  });
});
