import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { discoverJobs } from "../../src/services/jobDiscoveryService.js";
import type { JobSource, RawProviderJob } from "../../src/jobSources/jobSource.js";
import { InvalidDiscoveryInputError, ClaudeNotConfiguredError } from "../../src/utils/errors.js";

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

/** A minimal in-memory JobSource for isolating jobDiscoveryService from the real Remotive integration. */
function createFakeJobSource(jobs: RawProviderJob[], options: { searchJobs?: ReturnType<typeof vi.fn> } = {}): JobSource {
  const searchJobs = options.searchJobs ?? vi.fn(async () => jobs);
  return {
    name: "fake-source",
    searchJobs,
    async getJob(jobId: string) {
      return jobs.find((j) => String(j.externalJobId) === jobId) ?? null;
    },
    normalize(raw: RawProviderJob) {
      return raw; // fixtures are already Job-schema-shaped for these tests
    }
  };
}

function validMatchJson(): string {
  return JSON.stringify({
    matchScore: 78,
    interviewPotential: 65,
    careerGrowth: 60,
    futureAIValue: 55,
    recommendation: "CONSIDER",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason"
  });
}

function mockClaudeClient(): Anthropic {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: validMatchJson() }] }));
  return { messages: { create } } as unknown as Anthropic;
}

describe("jobDiscoveryService.discoverJobs — successful discovery", () => {
  it("runs the full pipeline end to end and returns matched, ranked top jobs", async () => {
    const jobSource = createFakeJobSource([rawJob()]);
    const claudeClient = mockClaudeClient();

    const result = await discoverJobs(
      { criteria: {} },
      { jobSource, claudeClient, profile, jobDiscoveryPreferences: {} }
    );

    expect(result.jobsFound).toBe(1);
    expect(result.jobsValid).toBe(1);
    expect(result.jobsAfterFiltering).toBe(1);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].matchScoreLabel).toBe("Estimated Application Match Score");
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(1);
  });
});

describe("jobDiscoveryService.discoverJobs — empty result", () => {
  it("returns all-zero counts and never calls Claude when the provider finds nothing", async () => {
    const jobSource = createFakeJobSource([]);
    const claudeClient = mockClaudeClient();

    const result = await discoverJobs({}, { jobSource, claudeClient, profile, jobDiscoveryPreferences: {} });

    expect(result).toEqual({ jobsFound: 0, jobsValid: 0, jobsAfterFiltering: 0, jobs: [] });
    expect(claudeClient.messages.create).not.toHaveBeenCalled();
  });
});

describe("jobDiscoveryService.discoverJobs — normalization and validation", () => {
  it("excludes jobs that fail to normalize (provider returns null) from jobsValid", async () => {
    const jobs = [rawJob({ externalJobId: "1" })];
    const jobSource: JobSource = {
      name: "fake-source",
      async searchJobs() {
        return jobs;
      },
      async getJob() {
        return null;
      },
      normalize() {
        return null; // simulates an unrecognized/malformed provider job
      }
    };

    const result = await discoverJobs({}, { jobSource, claudeClient: mockClaudeClient(), profile, jobDiscoveryPreferences: {} });

    expect(result.jobsFound).toBe(1);
    expect(result.jobsValid).toBe(0);
    expect(result.jobs).toEqual([]);
  });

  it("reports jobs that normalize but fail JobSchema validation as invalidJobs", async () => {
    const jobSource = createFakeJobSource([rawJob({ jobDescription: "" })]); // fails min-length validation
    const result = await discoverJobs({}, { jobSource, claudeClient: mockClaudeClient(), profile, jobDiscoveryPreferences: {} });

    expect(result.jobsValid).toBe(0);
    expect(result.invalidJobs).toHaveLength(1);
  });
});

describe("jobDiscoveryService.discoverJobs — deduplication", () => {
  it("deduplicates two provider records that normalize to the same source + externalJobId before Claude matching", async () => {
    const jobSource = createFakeJobSource([
      rawJob({ externalJobId: "1", sourceUrl: "https://remotive.com/a" }),
      rawJob({ externalJobId: "1", sourceUrl: "https://remotive.com/a-mirror" })
    ]);
    const claudeClient = mockClaudeClient();

    const result = await discoverJobs({}, { jobSource, claudeClient, profile, jobDiscoveryPreferences: {} });

    expect(result.jobsValid).toBe(2); // both pass validation individually
    expect(result.jobsAfterFiltering).toBe(1); // deduped before the deterministic filter/Claude stage
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(1);
  });
});

describe("jobDiscoveryService.discoverJobs — deterministic filtering", () => {
  it("filters out a job whose country isn't allowed and isn't remote", async () => {
    const jobSource = createFakeJobSource([rawJob({ remoteStatus: "ONSITE", country: "France", location: "Paris" })]);
    const claudeClient = mockClaudeClient();

    const result = await discoverJobs(
      { criteria: {} },
      { jobSource, claudeClient, profile, jobDiscoveryPreferences: { allowedCountries: ["Pakistan", "UAE"] } }
    );

    expect(result.jobsAfterFiltering).toBe(0);
    expect(claudeClient.messages.create).not.toHaveBeenCalled();
  });

  it("keeps a REMOTE job even when its listed country isn't in the allow-list", async () => {
    const jobSource = createFakeJobSource([rawJob({ remoteStatus: "REMOTE", country: "France" })]);
    const claudeClient = mockClaudeClient();

    const result = await discoverJobs(
      {},
      { jobSource, claudeClient, profile, jobDiscoveryPreferences: { allowedCountries: ["Pakistan", "UAE"], allowRemoteAnyCountry: true } }
    );

    expect(result.jobsAfterFiltering).toBe(1);
  });

  it("filters out a clearly unrelated role by title/description", async () => {
    const jobSource = createFakeJobSource([
      rawJob({
        jobTitle: "Regional Sales Manager",
        skills: ["Sales", "CRM"],
        jobDescription: "Manage a regional sales team and grow distributor relationships across the territory."
      })
    ]);
    const result = await discoverJobs({}, { jobSource, claudeClient: mockClaudeClient(), profile, jobDiscoveryPreferences: {} });

    expect(result.jobsAfterFiltering).toBe(0);
  });

  it("does not filter out an AI-titled role even though it lacks classic QA keywords (LLM Evaluation Engineer)", async () => {
    const jobSource = createFakeJobSource([
      rawJob({
        jobTitle: "LLM Evaluation Engineer",
        skills: ["Python", "Evaluation"],
        jobDescription: "Design and run evaluation frameworks for large language model outputs across releases."
      })
    ]);
    const claudeClient = mockClaudeClient();
    const result = await discoverJobs({}, { jobSource, claudeClient, profile, jobDiscoveryPreferences: {} });

    expect(result.jobsAfterFiltering).toBe(1);
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a job with a disclosed salary below an explicit minimum", async () => {
    const jobSource = createFakeJobSource([rawJob({ salary: 40000, currency: "USD" })]);
    const result = await discoverJobs(
      { criteria: { minimumSalary: 100000 } },
      { jobSource, claudeClient: mockClaudeClient(), profile, jobDiscoveryPreferences: {} }
    );

    expect(result.jobsAfterFiltering).toBe(0);
  });

  it("does not reject a job with no disclosed salary (UNKNOWN), even with a minimum configured", async () => {
    const jobSource = createFakeJobSource([rawJob()]); // no salary field at all
    const claudeClient = mockClaudeClient();
    const result = await discoverJobs(
      { criteria: { minimumSalary: 100000 } },
      { jobSource, claudeClient, profile, jobDiscoveryPreferences: {} }
    );

    expect(result.jobsAfterFiltering).toBe(1);
  });

  it("rejects a job matching an explicitly avoided role from job preferences", async () => {
    const jobSource = createFakeJobSource([rawJob({ jobTitle: "Manual QA Tester" })]);
    const result = await discoverJobs(
      {},
      { jobSource, claudeClient: mockClaudeClient(), profile, jobDiscoveryPreferences: { rolesToAvoid: ["Manual QA Tester"] } }
    );

    expect(result.jobsAfterFiltering).toBe(0);
  });
});

describe("jobDiscoveryService.discoverJobs — recency filtering", () => {
  it("filters out a job older than postedWithinDays", async () => {
    const jobSource = createFakeJobSource([rawJob({ datePosted: "2020-01-01" })]);
    const result = await discoverJobs(
      { criteria: { postedWithinDays: 30 } },
      { jobSource, claudeClient: mockClaudeClient(), profile, jobDiscoveryPreferences: {} }
    );

    expect(result.jobsAfterFiltering).toBe(0);
  });

  it("keeps jobs when postedWithinDays isn't specified", async () => {
    const jobSource = createFakeJobSource([rawJob({ datePosted: "2020-01-01" })]);
    const claudeClient = mockClaudeClient();
    const result = await discoverJobs({}, { jobSource, claudeClient, profile, jobDiscoveryPreferences: {} });

    expect(result.jobsAfterFiltering).toBe(1);
  });
});

describe("jobDiscoveryService.discoverJobs — integration with existing Job Matching and ranking", () => {
  it("calls the existing Claude job matching pipeline and surfaces its real output fields", async () => {
    const jobSource = createFakeJobSource([rawJob()]);
    const claudeClient = mockClaudeClient();

    const result = await discoverJobs({}, { jobSource, claudeClient, profile, jobDiscoveryPreferences: {} });

    expect(result.jobs[0].matchScore).toBe(78);
    expect(result.jobs[0].recommendation).toBe("CONSIDER");
    expect(result.jobs[0].classification).toBeDefined(); // proves the existing ranking logic ran
  });

  it("selects only the top 5 jobs by default when more than 5 are eligible", async () => {
    const jobs = Array.from({ length: 8 }, (_, i) =>
      rawJob({ externalJobId: String(i), sourceUrl: `https://remotive.com/job-${i}`, jobTitle: `Quality Engineer ${i}` })
    );
    const jobSource = createFakeJobSource(jobs);
    const claudeClient = mockClaudeClient();

    const result = await discoverJobs({}, { jobSource, claudeClient, profile, jobDiscoveryPreferences: {} });

    expect(result.jobsAfterFiltering).toBe(8);
    expect(result.jobs).toHaveLength(5);
  });

  it("throws ClaudeNotConfiguredError when eligible jobs exist but no Claude client is available", async () => {
    const jobSource = createFakeJobSource([rawJob()]);
    await expect(
      discoverJobs({}, { jobSource, profile, jobDiscoveryPreferences: {} })
    ).rejects.toBeInstanceOf(ClaudeNotConfiguredError);
  });

  it("does not require Claude when the job list is empty", async () => {
    const jobSource = createFakeJobSource([]);
    const result = await discoverJobs({}, { jobSource, profile, jobDiscoveryPreferences: {} });
    expect(result.jobsFound).toBe(0);
  });
});

describe("jobDiscoveryService.discoverJobs — criteria handling", () => {
  it("uses the default role-discovery list when the caller supplies no roleKeywords", async () => {
    const searchJobs = vi.fn(async () => [rawJob()]);
    const jobSource = createFakeJobSource([], { searchJobs });

    await discoverJobs({}, { jobSource, claudeClient: mockClaudeClient(), profile, jobDiscoveryPreferences: {} });

    const calledWith = searchJobs.mock.calls[0][0];
    expect(calledWith.roleKeywords).toContain("Principal QA Engineer");
    expect(calledWith.roleKeywords).toContain("AI Quality Engineer");
  });

  it("lets caller-supplied roleKeywords override the default list entirely", async () => {
    const searchJobs = vi.fn(async () => [rawJob()]);
    const jobSource = createFakeJobSource([], { searchJobs });

    await discoverJobs(
      { criteria: { roleKeywords: ["Custom Role"] } },
      { jobSource, claudeClient: mockClaudeClient(), profile, jobDiscoveryPreferences: {} }
    );

    const calledWith = searchJobs.mock.calls[0][0];
    expect(calledWith.roleKeywords).toEqual(["Custom Role"]);
  });

  it("throws InvalidDiscoveryInputError for malformed criteria", async () => {
    const jobSource = createFakeJobSource([]);
    await expect(
      discoverJobs({ criteria: { minimumSalary: -100 } }, { jobSource, claudeClient: mockClaudeClient(), profile, jobDiscoveryPreferences: {} })
    ).rejects.toBeInstanceOf(InvalidDiscoveryInputError);
  });

  it("pulls allowedCountries from job_preferences.md when jobDiscoveryPreferences isn't explicitly injected", async () => {
    // No jobDiscoveryPreferences override supplied — falls back to the real file,
    // which has Pakistan/UAE/Remote-Global as active Target Countries.
    const jobSource = createFakeJobSource([rawJob({ remoteStatus: "ONSITE", country: "France" })]);
    const result = await discoverJobs({}, { jobSource, claudeClient: mockClaudeClient(), profile });

    expect(result.jobsAfterFiltering).toBe(0); // France, onsite, not in the real Pakistan/UAE list
  });
});
