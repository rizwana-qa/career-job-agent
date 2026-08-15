import { describe, expect, it } from "vitest";
import { DiscoverMatchRequestSchema, DiscoverMatchResultSchema } from "../../src/schemas/careerDiscoverMatch.js";

function validJob() {
  return {
    jobTitle: "AI Quality Engineer",
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
    sourceUrl: "https://remotive.com/remote-jobs/qa/1",
    datePosted: "2026-08-10",
    externalJobId: "1"
  };
}

function validMatch() {
  return {
    matchScore: 82,
    interviewPotential: 70,
    careerGrowth: 60,
    futureAIValue: 75,
    recommendation: "APPLY",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason"
  };
}

function validTopJob() {
  return {
    jobId: "1",
    jobTitle: "AI Quality Engineer",
    company: "Vantage AI",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    postedAt: "2026-08-10",
    source: "remotive",
    sourceUrl: "https://remotive.com/remote-jobs/qa/1",
    careerRelevanceScore: 90,
    matchScore: 82,
    interviewPotential: 70,
    careerGrowth: 60,
    futureAIValue: 75,
    recommendation: "APPLY",
    whySelected: "Strong alignment with QA automation and quality engineering.",
    jobData: { job: validJob(), match: validMatch() }
  };
}

describe("DiscoverMatchRequestSchema", () => {
  it("applies maxJobs=10 and topJobs=5 defaults when no body is supplied", () => {
    const result = DiscoverMatchRequestSchema.parse({});
    expect(result).toEqual({ maxJobs: 10, topJobs: 5 });
  });

  it("accepts an explicit override of both fields", () => {
    const result = DiscoverMatchRequestSchema.parse({ maxJobs: 3, topJobs: 1 });
    expect(result).toEqual({ maxJobs: 3, topJobs: 1 });
  });

  it("rejects a non-positive maxJobs", () => {
    expect(DiscoverMatchRequestSchema.safeParse({ maxJobs: 0 }).success).toBe(false);
  });

  it("rejects a maxJobs above 200", () => {
    expect(DiscoverMatchRequestSchema.safeParse({ maxJobs: 201 }).success).toBe(false);
  });

  it("rejects a topJobs above 50", () => {
    expect(DiscoverMatchRequestSchema.safeParse({ topJobs: 51 }).success).toBe(false);
  });
});

describe("DiscoverMatchResultSchema", () => {
  it("validates a well-formed COMPLETED result with one top job", () => {
    const result = DiscoverMatchResultSchema.safeParse({
      status: "COMPLETED",
      jobsDiscovered: 10,
      jobsAfterFiltering: 8,
      jobsMatched: 5,
      matchingFailures: 0,
      relevanceFiltered: 2,
      sources: [{ name: "remotive", status: "OK", jobsFound: 10 }],
      topJobs: [validTopJob()]
    });
    expect(result.success).toBe(true);
  });

  it("validates an empty topJobs array", () => {
    const result = DiscoverMatchResultSchema.safeParse({
      status: "COMPLETED",
      jobsDiscovered: 0,
      jobsAfterFiltering: 0,
      jobsMatched: 0,
      matchingFailures: 0,
      relevanceFiltered: 0,
      sources: [],
      topJobs: []
    });
    expect(result.success).toBe(true);
  });

  it("rejects a topJob missing jobData", () => {
    const topJob = validTopJob() as Record<string, unknown>;
    delete topJob.jobData;
    const result = DiscoverMatchResultSchema.safeParse({
      status: "COMPLETED",
      jobsDiscovered: 1,
      jobsAfterFiltering: 1,
      jobsMatched: 1,
      matchingFailures: 0,
      relevanceFiltered: 0,
      sources: [],
      topJobs: [topJob]
    });
    expect(result.success).toBe(false);
  });

  it("rejects a topJob missing careerRelevanceScore", () => {
    const topJob = validTopJob() as Record<string, unknown>;
    delete topJob.careerRelevanceScore;
    const result = DiscoverMatchResultSchema.safeParse({
      status: "COMPLETED",
      jobsDiscovered: 1,
      jobsAfterFiltering: 1,
      jobsMatched: 1,
      matchingFailures: 0,
      relevanceFiltered: 0,
      sources: [],
      topJobs: [topJob]
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative matchingFailures count", () => {
    const result = DiscoverMatchResultSchema.safeParse({
      status: "FAILED",
      jobsDiscovered: 1,
      jobsAfterFiltering: 1,
      jobsMatched: 0,
      matchingFailures: -1,
      relevanceFiltered: 0,
      sources: [],
      topJobs: []
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative relevanceFiltered count", () => {
    const result = DiscoverMatchResultSchema.safeParse({
      status: "FAILED",
      jobsDiscovered: 1,
      jobsAfterFiltering: 1,
      jobsMatched: 0,
      matchingFailures: 0,
      relevanceFiltered: -1,
      sources: [],
      topJobs: []
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown status value", () => {
    const result = DiscoverMatchResultSchema.safeParse({
      status: "IN_PROGRESS",
      jobsDiscovered: 0,
      jobsAfterFiltering: 0,
      jobsMatched: 0,
      matchingFailures: 0,
      relevanceFiltered: 0,
      sources: [],
      topJobs: []
    });
    expect(result.success).toBe(false);
  });

  it("rejects a source diagnostic with an unknown status value", () => {
    const result = DiscoverMatchResultSchema.safeParse({
      status: "FAILED",
      jobsDiscovered: 0,
      jobsAfterFiltering: 0,
      jobsMatched: 0,
      matchingFailures: 0,
      relevanceFiltered: 0,
      sources: [{ name: "indeed", status: "DISABLED" }],
      topJobs: []
    });
    expect(result.success).toBe(false);
  });

  it("accepts multiple source diagnostics, including a FAILED one", () => {
    const result = DiscoverMatchResultSchema.safeParse({
      status: "PARTIAL",
      jobsDiscovered: 10,
      jobsAfterFiltering: 5,
      jobsMatched: 5,
      matchingFailures: 0,
      relevanceFiltered: 0,
      sources: [
        { name: "remotive", status: "OK", jobsFound: 10 },
        { name: "indeed", status: "FAILED" }
      ],
      topJobs: []
    });
    expect(result.success).toBe(true);
  });
});
