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

/** Same pattern as careerDiscoverMatchFinalSourceStack.test.ts — a single bare "quality" mention clears the basic Phase-2 filter without forming a real secondary-signal phrase, so the positive career prefilter is what's actually being tested for these irrelevant jobs. */
const GENERIC_NON_QA_DESCRIPTION =
  "This role focuses on day-to-day operations and cross-team coordination. Occasionally reviews quality reports for accuracy.";

const GENUINE_DESCRIPTION =
  "Own quality engineering strategy and test architecture across a growing platform, including automation, API testing, and CI/CD ownership.";

function rawJob(source: string, id: string, title: string, company: string, overrides: Record<string, unknown> = {}): RawProviderJob {
  return {
    jobTitle: title,
    company,
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: GENUINE_DESCRIPTION,
    requirements: ["See description"],
    responsibilities: ["See description"],
    skills: ["Testing"],
    source,
    sourceUrl: `https://${source}.example/${id}`,
    datePosted: "2026-08-14",
    externalJobId: id,
    ...overrides
  };
}

function irrelevantJob(source: string, id: string, title: string, company: string, overrides: Record<string, unknown> = {}): RawProviderJob {
  return rawJob(source, id, title, company, {
    jobDescription: GENERIC_NON_QA_DESCRIPTION,
    skills: ["General"],
    ...overrides
  });
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

function qaMatchJson(): string {
  return JSON.stringify({
    matchScore: 85,
    interviewPotential: 75,
    careerGrowth: 70,
    futureAIValue: 60,
    recommendation: "APPLY",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason",
    careerRelevanceScore: 90,
    whySelected: "Strong alignment with the target career family."
  });
}

/** Dispatches by company name in the prompt (see jobMatching.ts's formatJob, which always includes "Company: ${job.company}") — necessary because tier-based allocation reorders which job is sent to Claude first. */
function companyAwareClaudeClient(): Anthropic {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: qaMatchJson() }] }));
  return { messages: { create } } as unknown as Anthropic;
}

/**
 * Phase 8.5.15 §16 — three-source integration test (Himalayas=10, Remote
 * OK=10, Careerjet=10) covering deduplication, location filtering, pre-
 * Claude filtering, tier allocation, maxJobs, topJobs, and source reporting
 * together. All three sources are fakes injected via `jobSources` — this
 * never calls a real API (no live Claude/Himalayas/Remote OK/Careerjet
 * calls, per this phase's cost-control constraint).
 */
describe("POST /career/discover-match — Himalayas + Remote OK + Careerjet three-source funnel (Phase 8.5.15 §16)", () => {
  it("deduplicates across all three sources, pre-Claude-filters, allocates by tier, and reports every source", async () => {
    // --- Himalayas (10: 5 genuine tiered + 5 irrelevant) ---
    const himalayasJobs = [
      rawJob("himalayas", "h-1", "Principal QA Engineer", "Vantage Systems"), // TIER_1
      rawJob("himalayas", "h-2", "Staff SDET", "Solace AI"), // TIER_1
      rawJob("himalayas", "h-3", "Lead QA Engineer", "Oasis Tech"), // TIER_2 — dup of remoteok r-2
      rawJob("himalayas", "h-4", "AI Quality Engineer", "Nimbus Labs"), // TIER_4 — dup of careerjet cj-2
      rawJob("himalayas", "h-5", "Senior QA Engineer", "Driftwood Systems"), // TIER_3
      irrelevantJob("himalayas", "h-6", "Office Assistant", "Bright Apps"),
      irrelevantJob("himalayas", "h-7", "Service Desk Engineer", "Bright Apps"),
      irrelevantJob("himalayas", "h-8", "Manufacturing QA Technician", "Falcon Industrial"),
      irrelevantJob("himalayas", "h-9", "AI Trainer", "Prism Data"),
      irrelevantJob("himalayas", "h-10", "Sales Representative", "Northstar Retail")
    ];

    // --- Remote OK (10: 2 genuine tiered + 1 duplicate + 7 irrelevant) ---
    const remoteOkJobs = [
      irrelevantJob("remoteok", "r-1", "System Administrator", "Gridline Corp"),
      rawJob("remoteok", "r-2", "Lead QA Engineer", "Oasis Tech"), // dup of himalayas h-3
      rawJob("remoteok", "r-3", "QA Architect", "Zenith Corp"), // TIER_1
      irrelevantJob("remoteok", "r-4", "Recruiter", "Talent Bridge"),
      irrelevantJob("remoteok", "r-5", "Content Writer", "Wordsmith Media"),
      irrelevantJob("remoteok", "r-6", "Data Annotator", "Prism Data"),
      rawJob("remoteok", "r-7", "Senior Test Automation Engineer", "Crescent Systems"), // TIER_3
      irrelevantJob("remoteok", "r-8", "Accountant", "Ledger Partners"),
      irrelevantJob("remoteok", "r-9", "Food QA Inspector", "Harvest Foods"),
      irrelevantJob("remoteok", "r-10", "Graphic Designer", "Mu Studio")
    ];

    // --- Careerjet (10: 3 genuine tiered + 1 duplicate + 6 irrelevant) ---
    const careerjetJobs = [
      rawJob("careerjet", "cj-1", "LLM Evaluation Engineer", "Falcon Emirates"), // TIER_4
      rawJob("careerjet", "cj-2", "AI Quality Engineer", "Nimbus Labs"), // dup of himalayas h-4
      rawJob("careerjet", "cj-3", "Quality Engineering Lead", "VeriPark"), // TIER_2
      irrelevantJob("careerjet", "cj-4", "Administrative Assistant", "Falcon Emirates"),
      irrelevantJob("careerjet", "cj-5", "Textile Quality Inspector", "Loomcraft Mills"),
      irrelevantJob("careerjet", "cj-6", "Data Entry Clerk", "Ledger Partners"),
      rawJob("careerjet", "cj-7", "Senior Software Quality Engineer", "Aras Corporation"), // TIER_3
      irrelevantJob("careerjet", "cj-8", "RLHF Rater", "Prism Data"),
      irrelevantJob("careerjet", "cj-9", "Tier III Service Desk Engineer", "Gridline Corp"),
      irrelevantJob("careerjet", "cj-10", "Sales Development Representative", "Theta Group")
    ];

    expect(himalayasJobs).toHaveLength(10);
    expect(remoteOkJobs).toHaveLength(10);
    expect(careerjetJobs).toHaveLength(10);

    const claudeClient = companyAwareClaudeClient();
    const app = createApp({
      apiKey: API_KEY,
      jobSources: [fakeSource("himalayas", himalayasJobs), fakeSource("remoteok", remoteOkJobs), fakeSource("careerjet", careerjetJobs)],
      claudeClient,
      profile: matchingProfile,
      jobDiscoveryPreferences: {}
    });

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 5, topJobs: 5 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;

    // 30 raw -> 28 unique after 2 cross-source duplicate pairs removed.
    expect(body.jobsDiscovered).toBe(30);
    expect(body.jobsAfterFiltering).toBe(28);
    // 18 irrelevant jobs rejected before any Claude call.
    expect(body.preMatchFiltered).toBe(18);
    expect(body.relevanceFiltered).toBe(18);
    // 10 genuine candidates qualify; maxJobs=5 caps what's actually sent.
    expect(body.jobsSentToMatching).toBe(5);
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(5);
    expect(body.jobsMatched).toBe(5);
    expect(body.matchingFailures).toBe(0);
    expect(body.topJobs).toHaveLength(5);

    // Tier allocation: 3 Tier1 + 2 Tier2 candidates fill the maxJobs=5
    // budget ahead of the 2 Tier4 and 3 Tier3 candidates that also qualify.
    const searchTiersSent = body.topJobs.map((j) => j.searchTier).sort();
    expect(searchTiersSent).toEqual(["TIER_1", "TIER_1", "TIER_1", "TIER_2", "TIER_2"]);

    // Every source reported, with error isolation semantics intact (all succeeded here).
    expect(body.sources).toEqual(
      expect.arrayContaining([
        { name: "himalayas", status: "OK", jobsFound: 10 },
        { name: "remoteok", status: "OK", jobsFound: 10 },
        { name: "careerjet", status: "OK", jobsFound: 10 }
      ])
    );
    expect(body.status).toBe("COMPLETED");
  });

  it("isolates a Careerjet failure within the three-source stack without affecting Himalayas/Remote OK", async () => {
    const himalayasJobs = [rawJob("himalayas", "h-1", "Senior QA Engineer", "Vantage Systems")];
    const remoteOkJobs = [rawJob("remoteok", "r-1", "QA Architect", "Zenith Corp")];
    const claudeClient = companyAwareClaudeClient();

    const app = createApp({
      apiKey: API_KEY,
      jobSources: [
        fakeSource("himalayas", himalayasJobs),
        fakeSource("remoteok", remoteOkJobs),
        {
          name: "careerjet",
          searchJobs: vi.fn(async () => {
            throw new Error("Careerjet simulated outage");
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

    const response = await request(app)
      .post("/career/discover-match")
      .set("Authorization", `Bearer ${API_KEY}`)
      .send({ maxJobs: 5, topJobs: 5 });

    expect(response.status).toBe(200);
    const body: DiscoverMatchResult = response.body;
    expect(body.status).toBe("PARTIAL");
    expect(body.sources).toEqual(
      expect.arrayContaining([
        { name: "himalayas", status: "OK", jobsFound: 1 },
        { name: "remoteok", status: "OK", jobsFound: 1 },
        { name: "careerjet", status: "FAILED" }
      ])
    );
    expect(body.jobsDiscovered).toBe(2);
    expect(body.topJobs.length).toBeGreaterThan(0);
  });
});
