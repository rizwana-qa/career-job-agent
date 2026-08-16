import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { createApp } from "../../src/api/app.js";
import type { JobSource, RawProviderJob } from "../../src/jobSources/jobSource.js";
import type { DiscoverMatchResult } from "../../src/schemas/careerDiscoverMatch.js";

const API_KEY = "test-career-agent-key";

const matchingProfile = {
  professionalTitle: "Principal Software Quality Engineer",
  coreSkills: "Playwright, API Testing, SQL"
};

/** Generic, safe filler description — contains a single bare "quality" mention so titles with no inherent QA signal (Office Assistant, Sales Representative, etc.) still clear the pre-existing basic keyword filter, while never forming a real secondary-signal PHRASE (see careerRelevanceFilter.ts's SECONDARY_SKILL_SIGNALS) — the Phase 8.3.3 positive prefilter is still what's meant to reject them. */
const GENERIC_NON_QA_DESCRIPTION =
  "This role focuses on day-to-day operations and cross-team coordination. Occasionally reviews quality reports for accuracy.";

function rawJob(source: string, id: string, title: string, company: string, overrides: Record<string, unknown> = {}): RawProviderJob {
  return {
    jobTitle: title,
    company,
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: GENERIC_NON_QA_DESCRIPTION,
    requirements: ["See description"],
    responsibilities: ["See description"],
    skills: ["General"],
    source,
    sourceUrl: `https://${source}.example/${id}`,
    datePosted: "2026-08-10",
    externalJobId: id,
    ...overrides
  };
}

function fakeSource(name: string, jobs: RawProviderJob[]): JobSource {
  return {
    name,
    searchJobs: vi.fn(async () => jobs),
    async getJob() {
      return null;
    },
    normalize(raw: RawProviderJob) {
      return raw;
    }
  };
}

function qaMatchJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    matchScore: 85,
    interviewPotential: 70,
    careerGrowth: 65,
    futureAIValue: 60,
    recommendation: "APPLY",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason",
    careerRelevanceScore: 90,
    whySelected: "Strong alignment with the target career family.",
    ...overrides
  });
}

function queueClaudeClient(count: number): Anthropic {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: qaMatchJson() }] }));
  void count;
  return { messages: { create } } as unknown as Anthropic;
}

/**
 * Phase 8.5 §16 — 40 raw jobs across the 6 automated sources (10 Himalayas,
 * 8 Remote OK, 8 Careerjet, 6 Remotive, 4 Jobicy, 4 Jooble), including 3
 * cross-source duplicate pairs among the genuinely QA-relevant postings.
 * All 6 sources are injected as fakes via `jobSources` — this never calls
 * a real API (no live job-source calls, per this phase's constraint).
 */
describe("POST /career/discover-match — final source stack cross-source funnel (Phase 8.5 §16)", () => {
  it("deduplicates, pre-Claude-filters, and matches exactly the expected counts across 6 sources", async () => {
    // --- Himalayas (10: 3 QA + 7 non-QA) ---
    const himalayasJobs = [
      rawJob("himalayas", "h-1", "Principal QA Engineer", "Vantage Systems"), // dup of remotive rm-1
      rawJob("himalayas", "h-2", "Staff SDET", "Solace AI"),
      rawJob("himalayas", "h-3", "Lead QA Engineer", "Oasis Tech"), // dup of remoteok r-2
      rawJob("himalayas", "h-4", "Office Assistant", "Bright Apps"),
      rawJob("himalayas", "h-5", "Service Desk Engineer", "Bright Apps"),
      rawJob("himalayas", "h-6", "Sales Representative", "Northstar Retail"),
      rawJob("himalayas", "h-7", "Customer Support Specialist", "Northstar Retail"),
      rawJob("himalayas", "h-8", "AI Trainer", "Prism Data"),
      rawJob("himalayas", "h-9", "Manufacturing QA Technician", "Falcon Industrial"),
      rawJob("himalayas", "h-10", "Food QA Inspector", "Harvest Foods")
    ];

    // --- Remote OK (8: 2 QA + 6 non-QA) ---
    const remoteOkJobs = [
      rawJob("remoteok", "r-1", "AI Quality Engineer", "Nimbus Labs"), // dup of jobicy jc-1
      rawJob("remoteok", "r-2", "Lead QA Engineer", "Oasis Tech"), // dup of himalayas h-3
      rawJob("remoteok", "r-3", "System Administrator", "Gridline Corp"),
      rawJob("remoteok", "r-4", "Data Annotator", "Prism Data"),
      rawJob("remoteok", "r-5", "Recruiter", "Talent Bridge"),
      rawJob("remoteok", "r-6", "Content Writer", "Wordsmith Media"),
      rawJob("remoteok", "r-7", "Graphic Designer", "Wordsmith Media"),
      rawJob("remoteok", "r-8", "Accountant", "Ledger Partners")
    ];

    // --- Careerjet (8: 2 QA + 6 non-QA) ---
    const careerjetJobs = [
      rawJob("careerjet", "c-1", "QA Architect", "Falcon Emirates"),
      rawJob("careerjet", "c-2", "SDET", "Zenith Corp"),
      rawJob("careerjet", "c-3", "Construction QA Manager", "Skyline Builders"),
      rawJob("careerjet", "c-4", "Warehouse QA Associate", "Freight Direct"),
      rawJob("careerjet", "c-5", "Social Media Manager", "BuzzWorks"),
      rawJob("careerjet", "c-6", "Office Assistant", "BuzzWorks"),
      rawJob("careerjet", "c-7", "Data Entry Clerk", "Ledger Partners"),
      rawJob("careerjet", "c-8", "BPO Quality Analyst", "Contact Sphere")
    ];

    // --- Remotive (6: 2 QA + 4 non-QA) ---
    const remotiveJobs = [
      rawJob("remotive", "rm-1", "Principal QA Engineer", "Vantage Systems"), // dup of himalayas h-1
      rawJob("remotive", "rm-2", "Senior QA Engineer", "Driftwood Systems"),
      rawJob("remotive", "rm-3", "Tier III Service Desk Engineer", "Gridline Corp"),
      rawJob("remotive", "rm-4", "Help Desk Technician", "Gridline Corp"),
      rawJob("remotive", "rm-5", "AI Data Annotator", "Prism Data"),
      rawJob("remotive", "rm-6", "Textile QC Supervisor", "Loomcraft Mills")
    ];

    // --- Jobicy (4: 2 QA + 2 non-QA) ---
    const jobicyJobs = [
      rawJob("jobicy", "jc-1", "AI Quality Engineer", "Nimbus Labs"), // dup of remoteok r-1
      rawJob("jobicy", "jc-2", "RAG Testing Engineer", "Solace AI"),
      rawJob("jobicy", "jc-3", "Network Administrator", "Gridline Corp"),
      rawJob("jobicy", "jc-4", "Calibration Technician", "Falcon Industrial")
    ];

    // --- Jooble (4: 1 QA + 3 non-QA) ---
    const joobleJobs = [
      rawJob("jooble", "jb-1", "Test Automation Engineer", "Crescent Systems"),
      rawJob("jooble", "jb-2", "Office Assistant", "Crescent Systems"),
      rawJob("jooble", "jb-3", "NDT Inspector", "Falcon Industrial"),
      rawJob("jooble", "jb-4", "Oil and Gas Inspection Engineer", "Falcon Industrial")
    ];

    expect(himalayasJobs).toHaveLength(10);
    expect(remoteOkJobs).toHaveLength(8);
    expect(careerjetJobs).toHaveLength(8);
    expect(remotiveJobs).toHaveLength(6);
    expect(jobicyJobs).toHaveLength(4);
    expect(joobleJobs).toHaveLength(4);
    const totalRaw =
      himalayasJobs.length + remoteOkJobs.length + careerjetJobs.length + remotiveJobs.length + jobicyJobs.length + joobleJobs.length;
    expect(totalRaw).toBe(40);

    const claudeClient = queueClaudeClient(9);
    const app = createApp({
      apiKey: API_KEY,
      jobSources: [
        fakeSource("himalayas", himalayasJobs),
        fakeSource("remoteok", remoteOkJobs),
        fakeSource("careerjet", careerjetJobs),
        fakeSource("remotive", remotiveJobs),
        fakeSource("jobicy", jobicyJobs),
        fakeSource("jooble", joobleJobs)
      ],
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 40, topJobs: 5 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;

    // 40 raw -> 37 unique after 3 cross-source duplicate pairs removed.
    expect(body.jobsDiscovered).toBe(40);
    expect(body.jobsAfterFiltering).toBe(37);
    // 28 non-QA jobs rejected before any Claude call (hard negative / non-software-QA / insufficient positive signal).
    expect(body.preMatchFiltered).toBe(28);
    expect(body.relevanceFiltered).toBe(28);
    // Only the 9 unique QA-relevant jobs reach Claude.
    expect(body.jobsSentToMatching).toBe(9);
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(9);
    expect(body.jobsMatched).toBe(9);
    expect(body.matchingFailures).toBe(0);
    // topJobs capped at the requested 5, even though 9 jobs matched and gated successfully.
    expect(body.topJobs).toHaveLength(5);

    // Every source reported, with error isolation semantics intact (all succeeded here).
    expect(body.sources).toEqual(
      expect.arrayContaining([
        { name: "himalayas", status: "OK", jobsFound: 10 },
        { name: "remoteok", status: "OK", jobsFound: 8 },
        { name: "careerjet", status: "OK", jobsFound: 8 },
        { name: "remotive", status: "OK", jobsFound: 6 },
        { name: "jobicy", status: "OK", jobsFound: 4 },
        { name: "jooble", status: "OK", jobsFound: 4 }
      ])
    );
    expect(body.status).toBe("COMPLETED");
  });

  it("isolates a single source failure within the 6-source stack without affecting the others", async () => {
    const workingJobs = [rawJob("himalayas", "h-1", "Senior QA Engineer", "Vantage Systems")];
    const claudeClient = queueClaudeClient(1);

    const app = createApp({
      apiKey: API_KEY,
      jobSources: [
        fakeSource("himalayas", workingJobs),
        {
          name: "remoteok",
          searchJobs: vi.fn(async () => {
            throw new Error("Remote OK simulated outage");
          }),
          async getJob() {
            return null;
          },
          normalize: (raw) => raw
        }
      ],
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app).post("/career/discover-match").set("Authorization", `Bearer ${API_KEY}`).send({});

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.status).toBe("PARTIAL");
    expect(body.sources).toEqual(
      expect.arrayContaining([
        { name: "himalayas", status: "OK", jobsFound: 1 },
        { name: "remoteok", status: "FAILED" }
      ])
    );
    expect(body.jobsDiscovered).toBe(1);
    expect(body.topJobs.length).toBeGreaterThan(0);
  });
});
