import { describe, expect, it } from "vitest";
import { ProcessJobRequestSchema, ProcessJobResultSchema } from "../../src/schemas/careerProcessJob.js";

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

describe("ProcessJobRequestSchema", () => {
  it("accepts a well-formed request", () => {
    const result = ProcessJobRequestSchema.safeParse({
      jobId: "1",
      resumeProcessing: true,
      jobData: { job: validJob(), match: validMatch() }
    });
    expect(result.success).toBe(true);
  });

  it("rejects a request missing jobData", () => {
    const result = ProcessJobRequestSchema.safeParse({ jobId: "1", resumeProcessing: true });
    expect(result.success).toBe(false);
  });

  it("rejects a request with an empty jobId", () => {
    const result = ProcessJobRequestSchema.safeParse({
      jobId: "",
      resumeProcessing: true,
      jobData: { job: validJob(), match: validMatch() }
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-boolean resumeProcessing", () => {
    const result = ProcessJobRequestSchema.safeParse({
      jobId: "1",
      resumeProcessing: "yes",
      jobData: { job: validJob(), match: validMatch() }
    });
    expect(result.success).toBe(false);
  });

  it("rejects jobData with an invalid match (bad recommendation)", () => {
    const result = ProcessJobRequestSchema.safeParse({
      jobId: "1",
      resumeProcessing: true,
      jobData: { job: validJob(), match: { ...validMatch(), recommendation: "MAYBE" } }
    });
    expect(result.success).toBe(false);
  });
});

describe("ProcessJobResultSchema", () => {
  it("validates a well-formed COMPLETED result", () => {
    const result = ProcessJobResultSchema.safeParse({
      status: "COMPLETED",
      jobId: "1",
      company: "Vantage AI",
      jobTitle: "AI Quality Engineer",
      resumeQAStatus: "PASS",
      resumeQAOverallScore: 85,
      applicationPackageCreated: true
    });
    expect(result.success).toBe(true);
  });

  it("validates a FAILED result with the NOT_REACHED placeholder", () => {
    const result = ProcessJobResultSchema.safeParse({
      status: "FAILED",
      jobId: "1",
      company: "Vantage AI",
      jobTitle: "AI Quality Engineer",
      resumeQAStatus: "NOT_REACHED",
      resumeQAOverallScore: 0,
      applicationPackageCreated: false
    });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-range resumeQAOverallScore", () => {
    const result = ProcessJobResultSchema.safeParse({
      status: "COMPLETED",
      jobId: "1",
      company: "Vantage AI",
      jobTitle: "AI Quality Engineer",
      resumeQAStatus: "PASS",
      resumeQAOverallScore: 101,
      applicationPackageCreated: true
    });
    expect(result.success).toBe(false);
  });
});
