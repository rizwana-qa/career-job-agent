import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateApplicationPackage, generateResumeVersion } from "../../src/services/applicationPackageService.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";
import { JobMatchSchema, type JobMatch } from "../../src/schemas/jobMatch.js";
import { TailoredResumeSchema, type TailoredResume } from "../../src/schemas/tailoredResume.js";
import { ResumeQAReportSchema, type ResumeQAReport } from "../../src/schemas/resumeQA.js";
import { ApplicationPackageSchema } from "../../src/schemas/applicationPackage.js";
import {
  InvalidApplicationPackageInputError,
  ClaudeResponseValidationError,
  InvalidClaudeResponseError,
  ClaudeApiError
} from "../../src/utils/errors.js";
import { loadJobFixture } from "../helpers/fixtures.js";

const careerProfile = {
  professionalTitle: "Principal Software Quality Engineer | AI, RAG and LLM Testing Specialist",
  ragSkills: "RAG platform testing — retrieval accuracy, hallucination detection, vector database validation",
  achievements: "35 to 40% reduction in production defects; 60% test coverage"
};

const masterResume =
  "Rizwana Zahoor — Principal Quality Assurance Engineer, Clustox. " +
  "Tested a RAG based AI coaching platform, validating retrieval accuracy and hallucination detection " +
  "as part of hands-on RAG Testing work. Achieved a 35 to 40% reduction in production defects.";

function job(): Job {
  return JobSchema.parse(loadJobFixture("04-ai-quality-engineer.json"));
}

function jobMatch(overrides: Partial<JobMatch> = {}): JobMatch {
  return JobMatchSchema.parse({
    matchScore: 82,
    interviewPotential: 70,
    careerGrowth: 65,
    futureAIValue: 85,
    recommendation: "APPLY",
    strongMatches: [{ statement: "RAG testing experience.", evidence: "FACT" }],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "Strong RAG/AI testing alignment.",
    ...overrides
  });
}

function tailoredResume(overrides: Record<string, unknown> = {}): TailoredResume {
  return TailoredResumeSchema.parse({
    jobId: "job-1",
    targetRole: "AI Quality Engineer",
    targetCompany: "Vantage AI",
    professionalSummary: "Principal QA leader with RAG testing experience.",
    coreSkills: ["RAG Testing"],
    experience: [
      {
        title: "Principal Quality Assurance Engineer",
        company: "Clustox",
        dates: "Mar 2022 to Present",
        bullets: ["Tested a RAG based AI coaching platform, validating retrieval accuracy."]
      }
    ],
    education: [],
    certifications: [],
    matchedRequirements: [],
    transferableRequirements: [],
    gaps: [],
    keywordsAdded: [],
    changesMade: [],
    claimsRequiringVerification: [],
    tailoredResume: "Full tailored resume text.",
    status: "READY_FOR_RESUME_QA",
    ...overrides
  });
}

function resumeQA(overrides: Record<string, unknown> = {}): ResumeQAReport {
  return ResumeQAReportSchema.parse({
    status: "PASS",
    overallScore: 85,
    jdAlignmentScore: 80,
    factualAccuracyScore: 95,
    interviewReadinessScore: 82,
    criticalIssues: [],
    highIssues: [],
    mediumIssues: [],
    lowIssues: [],
    strengths: ["Strong RAG narrative."],
    mandatoryRequirements: [],
    preferredRequirements: [],
    supportedKeywords: ["RAG Testing"],
    missingImportantKeywords: [],
    unsupportedKeywords: [],
    overusedKeywords: [],
    unsupportedClaims: [],
    transferableClaims: [],
    recommendations: [],
    humanReviewRequired: false,
    ...overrides
  });
}

function mockClient(responseText: string | (() => string)): Anthropic {
  const create = vi.fn(async () => ({
    content: [{ type: "text", text: typeof responseText === "function" ? responseText() : responseText }]
  }));
  return { messages: { create } } as unknown as Anthropic;
}

function messageJson(text = "Thank you for considering my application for this role."): string {
  return JSON.stringify({ applicationMessage: text });
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    job: job(),
    jobMatch: jobMatch(),
    careerProfile,
    masterResume,
    tailoredResume: tailoredResume(),
    resumeQA: resumeQA(),
    ...overrides
  };
}

describe("applicationPackageService — 14 required scenarios", () => {
  it("1. valid PASS package is generated with status READY_FOR_REVIEW", async () => {
    const client = mockClient(messageJson());
    const result = await generateApplicationPackage(baseInput(), { claudeClient: client });

    expect(result.status).toBe("READY_FOR_REVIEW");
    if (result.status === "READY_FOR_REVIEW") {
      expect(result.applicationStatus).toBe("READY_FOR_REVIEW");
      expect(result.qaStatus).toBe("PASS");
      expect(result.applicationMessage).toContain("Thank you for considering");
    }
  });

  it("2. Resume QA FAIL -> returns a FAILED result, never calls Claude", async () => {
    const client = mockClient(messageJson());
    const input = baseInput({
      resumeQA: resumeQA({
        status: "FAIL",
        criticalIssues: [{ severity: "CRITICAL", dimension: "Factual Accuracy", description: "Fabricated certification.", evidence: "No such cert in Master Resume." }]
      })
    });

    const result = await generateApplicationPackage(input, { claudeClient: client });

    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.qaStatus).toBe("FAIL");
      expect(result.criticalIssueSummaries).toContain("Fabricated certification.");
    }
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("3. Resume QA REVIEW_REQUIRED -> returns HUMAN_REVIEW_REQUIRED, never calls Claude, no package generated", async () => {
    const client = mockClient(messageJson());
    const input = baseInput({ resumeQA: resumeQA({ status: "REVIEW_REQUIRED", humanReviewRequired: true }) });

    const result = await generateApplicationPackage(input, { claudeClient: client });

    expect(result.status).toBe("HUMAN_REVIEW_REQUIRED");
    if (result.status === "HUMAN_REVIEW_REQUIRED") {
      expect(result.qaStatus).toBe("REVIEW_REQUIRED");
    }
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("4. missing tailored resume -> InvalidApplicationPackageInputError, Claude never called", async () => {
    const client = mockClient(messageJson());
    await expect(
      generateApplicationPackage(baseInput({ tailoredResume: { tailoredResume: "" } }), { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidApplicationPackageInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("5. missing job -> InvalidApplicationPackageInputError", async () => {
    const client = mockClient(messageJson());
    await expect(
      generateApplicationPackage(baseInput({ job: undefined }), { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidApplicationPackageInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("6. invalid job -> InvalidApplicationPackageInputError", async () => {
    const client = mockClient(messageJson());
    await expect(
      generateApplicationPackage(baseInput({ job: { jobTitle: "Broken" } }), { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidApplicationPackageInputError);
  });

  it("7. invalid QA result -> InvalidApplicationPackageInputError, Claude never called", async () => {
    const client = mockClient(messageJson());
    await expect(
      generateApplicationPackage(baseInput({ resumeQA: { status: "BOGUS" } }), { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidApplicationPackageInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("8. unsupported claim in the generated application message is flagged, not silently accepted", async () => {
    // "Python" is a listed skill on the AI Quality Engineer... actually use the
    // LLM evaluation fixture, which lists Python, and source material has no Python.
    const pythonJob = JobSchema.parse(loadJobFixture("06-llm-evaluation-engineer.json"));
    const client = mockClient(messageJson("I have hands-on Python experience relevant to this role."));

    const result = await generateApplicationPackage(baseInput({ job: pythonJob }), { claudeClient: client });

    expect(result.status).toBe("READY_FOR_REVIEW");
    if (result.status === "READY_FOR_REVIEW") {
      expect(result.applicationMessageUnsupportedClaims).toContain("Python");
    }
  });

  it("9. application message generation reflects Claude's actual output", async () => {
    const client = mockClient(messageJson("I'm excited to bring my RAG testing background to this role."));
    const result = await generateApplicationPackage(baseInput(), { claudeClient: client });

    expect(result.status).toBe("READY_FOR_REVIEW");
    if (result.status === "READY_FOR_REVIEW") {
      expect(result.applicationMessage).toBe("I'm excited to bring my RAG testing background to this role.");
    }
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("10. invalid Claude response (non-JSON) -> InvalidClaudeResponseError", async () => {
    const client = mockClient("Sure, here's a message for you: ...");
    await expect(generateApplicationPackage(baseInput(), { claudeClient: client })).rejects.toBeInstanceOf(
      InvalidClaudeResponseError
    );
  });

  it("11. schema validation failure (empty applicationMessage) -> ClaudeResponseValidationError", async () => {
    const client = mockClient(JSON.stringify({ applicationMessage: "" }));
    await expect(generateApplicationPackage(baseInput(), { claudeClient: client })).rejects.toBeInstanceOf(
      ClaudeResponseValidationError
    );
  });

  it("12. master resume string is never mutated by the call", async () => {
    const originalMasterResume = masterResume;
    const client = mockClient(messageJson());

    await generateApplicationPackage(baseInput(), { claudeClient: client });

    expect(masterResume).toBe(originalMasterResume);
    expect(masterResume).toContain("Rizwana Zahoor");
  });

  it("13. applicationStatus and status are both READY_FOR_REVIEW on a successful package", async () => {
    const client = mockClient(messageJson());
    const result = await generateApplicationPackage(baseInput(), { claudeClient: client });

    expect(result.status).toBe("READY_FOR_REVIEW");
    if (result.status === "READY_FOR_REVIEW") {
      expect(result.applicationStatus).toBe("READY_FOR_REVIEW");
    }
  });

  it("14. the schema structurally rejects APPLIED — no code path in this phase can produce it", () => {
    const client = mockClient(messageJson());
    void client; // not used in this schema-level test

    const hypotheticalAppliedPackage = {
      applicationId: "x",
      status: "READY_FOR_REVIEW",
      jobId: "job-1",
      company: "Vantage AI",
      role: "AI Quality Engineer",
      source: "manual",
      sourceUrl: "https://example.com/jobs/1",
      matchScore: 80,
      resumeVersion: "AI_QUALITY_ENGINEER_VANTAGE_AI_20260101",
      qaStatus: "PASS",
      applicationStatus: "APPLIED", // <-- the forbidden value
      job: { jobTitle: "x", company: "x", location: "x", country: "x", remoteStatus: "REMOTE", sourceUrl: "https://example.com", salary: "UNKNOWN", currency: "UNKNOWN" },
      jobMatch: { matchScore: 80, matchScoreLabel: "x", interviewPotential: 80, careerGrowth: 80, strongMatches: [], transferableSkills: [], gaps: [] },
      resume: tailoredResume(),
      resumeQA: { status: "PASS", jdAlignmentScore: 80, factualAccuracyScore: 80, interviewReadinessScore: 80, importantKeywords: [], missingKeywords: [] },
      applicationMessage: "x",
      applicationMessageUnsupportedClaims: [],
      createdAt: new Date().toISOString()
    };

    const result = ApplicationPackageSchema.safeParse(hypotheticalAppliedPackage);
    expect(result.success).toBe(false);
  });
});

describe("applicationPackageService — additional input validation", () => {
  it("throws InvalidApplicationPackageInputError for a missing job match", async () => {
    const client = mockClient(messageJson());
    await expect(
      generateApplicationPackage(baseInput({ jobMatch: undefined }), { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidApplicationPackageInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("throws InvalidApplicationPackageInputError for an empty career profile", async () => {
    const client = mockClient(messageJson());
    await expect(
      generateApplicationPackage(baseInput({ careerProfile: {} }), { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidApplicationPackageInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("throws InvalidApplicationPackageInputError for an empty master resume", async () => {
    const client = mockClient(messageJson());
    await expect(
      generateApplicationPackage(baseInput({ masterResume: "" }), { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidApplicationPackageInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });
});

describe("applicationPackageService — Claude retry/error handling for the message step", () => {
  it("retries once on a transient failure and succeeds on the second attempt", async () => {
    let calls = 0;
    const client = mockClient(() => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("Service Unavailable"), { status: 503 });
      }
      return messageJson();
    });

    const result = await generateApplicationPackage(baseInput(), { claudeClient: client });
    expect(result.status).toBe("READY_FOR_REVIEW");
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry limit and throws ClaudeApiError", async () => {
    const client = mockClient(() => {
      throw Object.assign(new Error("Request Timeout"), { name: "APIConnectionTimeoutError" });
    });

    await expect(generateApplicationPackage(baseInput(), { claudeClient: client })).rejects.toBeInstanceOf(ClaudeApiError);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable error (401)", async () => {
    const client = mockClient(() => {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    });

    await expect(generateApplicationPackage(baseInput(), { claudeClient: client })).rejects.toBeInstanceOf(ClaudeApiError);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });
});

describe("applicationPackageService.generateResumeVersion", () => {
  it("produces a deterministic ROLE_COMPANY_DATE identifier", () => {
    const version = generateResumeVersion(job(), new Date("2026-08-15T12:00:00Z"));
    expect(version).toBe("AI_QUALITY_ENGINEER_VANTAGE_AI_20260815");
  });

  it("is stable for the same job and date (deterministic, not random)", () => {
    const date = new Date("2026-08-15T00:00:00Z");
    expect(generateResumeVersion(job(), date)).toBe(generateResumeVersion(job(), date));
  });

  it("sanitizes non-alphanumeric characters out of the role/company slugs", () => {
    const messyJob = { ...job(), jobTitle: "AI/ML Quality Engineer!", company: "Vantage & Co." };
    const version = generateResumeVersion(messyJob, new Date("2026-01-05T00:00:00Z"));
    expect(version).toBe("AI_ML_QUALITY_ENGINEER_VANTAGE_CO_20260105");
  });
});
