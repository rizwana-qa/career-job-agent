import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { reviewResume } from "../../src/services/resumeQAService.js";
import { TailoredResumeSchema, type TailoredResume } from "../../src/schemas/tailoredResume.js";
import { ResumeEvidenceReportSchema, type ResumeEvidenceReport } from "../../src/schemas/resumeEvidence.js";
import { InvalidQAInputError, ClaudeResponseValidationError, InvalidClaudeResponseError } from "../../src/utils/errors.js";
import { loadJobFixture } from "../helpers/fixtures.js";

const careerProfile = {
  professionalTitle: "Principal Software Quality Engineer | AI, RAG and LLM Testing Specialist",
  ragSkills: "RAG platform testing — retrieval accuracy, hallucination detection, vector database validation",
  automation: "Playwright (API and UI) automation framework design, CI-ready structure",
  leadership: "Own test strategy for banking and fintech environments; lead process improvements",
  achievements: "35 to 40% reduction in production defects; 60% test coverage"
};

const masterResume =
  "Rizwana Zahoor — Principal Quality Assurance Engineer, Clustox. " +
  "Tested a RAG based AI coaching platform, validating retrieval accuracy and hallucination detection " +
  "as part of hands-on RAG Testing work. " +
  "Built AI-assisted Playwright automation covering UI and API testing. " +
  "Own test strategy, API and backend validation for banking and fintech environments. " +
  "Achieved a 35 to 40% reduction in production defects.";

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

function passingEvidenceGuardResult(): ResumeEvidenceReport {
  return ResumeEvidenceReportSchema.parse({
    status: "PASS",
    evidenceScore: 100,
    claimsReviewed: 1,
    supportedClaims: [{ claim: "Tested RAG platform.", sourceLocation: "professionalSummary", evidence: "Confirmed.", classification: "SUPPORTED" }],
    transferableClaims: [],
    potentiallyUnsupportedClaims: [],
    unsupportedClaims: [],
    unknownClaims: [],
    recommendations: []
  });
}

interface IssueSpec {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  dimension: string;
  description: string;
  evidence: string;
}

function issue(overrides: Partial<IssueSpec> = {}): IssueSpec {
  return {
    severity: "MEDIUM",
    dimension: "Keyword Quality",
    description: "A minor issue.",
    evidence: "Some grounding.",
    ...overrides
  };
}

function qaReportJson(options: {
  issues?: IssueSpec[];
  claudeStatus?: "PASS" | "FAIL" | "REVIEW_REQUIRED";
  overusedKeywords?: string[];
  missingImportantKeywords?: string[];
  mandatoryRequirements?: Record<string, unknown>[];
}) {
  const issues = options.issues ?? [];
  const bucketed = {
    criticalIssues: issues.filter((i) => i.severity === "CRITICAL"),
    highIssues: issues.filter((i) => i.severity === "HIGH"),
    mediumIssues: issues.filter((i) => i.severity === "MEDIUM"),
    lowIssues: issues.filter((i) => i.severity === "LOW")
  };

  return JSON.stringify({
    status: options.claudeStatus ?? (bucketed.criticalIssues.length > 0 ? "FAIL" : "PASS"),
    overallScore: 80,
    jdAlignmentScore: 75,
    factualAccuracyScore: 90,
    interviewReadinessScore: 78,
    ...bucketed,
    strengths: ["Solid technical depth."],
    mandatoryRequirements: options.mandatoryRequirements ?? [],
    preferredRequirements: [],
    supportedKeywords: ["RAG Testing"],
    missingImportantKeywords: options.missingImportantKeywords ?? [],
    unsupportedKeywords: [],
    overusedKeywords: options.overusedKeywords ?? [],
    unsupportedClaims: [],
    transferableClaims: [],
    recommendations: [],
    humanReviewRequired: bucketed.criticalIssues.length > 0 || bucketed.highIssues.length > 0
  });
}

function mockClient(responseText: string): Anthropic {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: responseText }] }));
  return { messages: { create } } as unknown as Anthropic;
}

function fixtureJob(filename: string): unknown {
  return loadJobFixture(filename);
}

describe("resumeQAService — 20 required scenarios", () => {
  it("1. excellent tailored resume -> PASS, no issues, humanReviewRequired false", async () => {
    const client = mockClient(qaReportJson({ issues: [] }));

    const result = await reviewResume(
      { job: fixtureJob("04-ai-quality-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("PASS");
    expect(result.humanReviewRequired).toBe(false);
  });

  it("2. poor JD alignment -> low jdAlignmentScore, MEDIUM issues only, still PASS (no critical/high)", async () => {
    const client = mockClient(
      qaReportJson({ issues: [issue({ dimension: "JD Alignment", description: "Weak alignment with core JD terms." })] })
    );

    const result = await reviewResume(
      { job: fixtureJob("04-ai-quality-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("PASS");
    expect(result.mediumIssues).toHaveLength(1);
  });

  it("3. missing mandatory requirement -> HIGH issue -> REVIEW_REQUIRED (Claude reported PASS, downgraded)", async () => {
    const client = mockClient(
      qaReportJson({
        claudeStatus: "PASS",
        issues: [issue({ severity: "HIGH", dimension: "JD Alignment", description: "Mandatory Python requirement is missing." })],
        mandatoryRequirements: [{ requirement: "Python for eval tooling", evidence: "Not present in Master Resume.", matchType: "GAP" }]
      })
    );

    const result = await reviewResume(
      { job: fixtureJob("06-llm-evaluation-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.humanReviewRequired).toBe(true);
    expect(result.mandatoryRequirements[0].matchType).toBe("GAP");
  });

  it("4. unsupported (fabricated) technology -> CRITICAL -> FAIL", async () => {
    const client = mockClient(
      qaReportJson({
        issues: [issue({ severity: "CRITICAL", dimension: "Factual Accuracy", description: "Claims Kubernetes expertise not in source material.", evidence: "No mention of Kubernetes anywhere in Master Resume or Career Profile." })]
      })
    );

    const result = await reviewResume(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("FAIL");
    expect(result.humanReviewRequired).toBe(true);
  });

  it("5. invented certification -> CRITICAL -> FAIL", async () => {
    const client = mockClient(
      qaReportJson({
        issues: [issue({ severity: "CRITICAL", dimension: "Factual Accuracy", description: "Claims a Certified Kubernetes Administrator credential.", evidence: "No such certification in the Master Resume." })]
      })
    );

    const result = await reviewResume(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("FAIL");
  });

  it("6. invented metric -> CRITICAL -> FAIL", async () => {
    const client = mockClient(
      qaReportJson({
        issues: [issue({ severity: "CRITICAL", dimension: "Factual Accuracy", description: "Claims a 70% defect reduction; master resume supports only 35-40%.", evidence: "Master resume states 35 to 40% reduction." })]
      })
    );

    const result = await reviewResume(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume({ tailoredResume: "Reduced defects by 70%." }), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("FAIL");
  });

  it("7. invented responsibility -> CRITICAL -> FAIL", async () => {
    const client = mockClient(
      qaReportJson({
        issues: [issue({ severity: "CRITICAL", dimension: "Factual Accuracy", description: "Claims direct management of 40 engineers; master resume shows an IC role.", evidence: "No management scope described in Master Resume." })]
      })
    );

    const result = await reviewResume(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("FAIL");
  });

  it("8. invented AI experience -> CRITICAL -> FAIL", async () => {
    const client = mockClient(
      qaReportJson({
        issues: [issue({ severity: "CRITICAL", dimension: "AI Skill Alignment", description: "Claims LLM fine-tuning experience not supported by source material.", evidence: "Master resume shows RAG/agentic QA testing, not model training." })]
      })
    );

    const result = await reviewResume(
      { job: fixtureJob("06-llm-evaluation-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("FAIL");
  });

  it("9. invented leadership claim -> CRITICAL -> FAIL", async () => {
    const client = mockClient(
      qaReportJson({
        issues: [issue({ severity: "CRITICAL", dimension: "Leadership Alignment", description: "Claims a VP of Engineering title not present anywhere in the source.", evidence: "Master resume shows Principal QA Engineer, a senior IC role." })]
      })
    );

    const result = await reviewResume(
      { job: fixtureJob("08-quality-engineering-lead.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("FAIL");
  });

  it("10. Evidence Guard conflict -> QA independently finds a CRITICAL issue despite Evidence Guard reporting PASS", async () => {
    // Evidence Guard (a separate, untrusted pass) found nothing wrong, but
    // the independent QA reviewer disagrees and flags a fabrication anyway.
    const client = mockClient(
      qaReportJson({
        issues: [issue({ severity: "CRITICAL", dimension: "Factual Accuracy", description: "Evidence Guard missed a fabricated claim; independently confirmed unsupported.", evidence: "No mention in Master Resume or Career Profile." })]
      })
    );

    const result = await reviewResume(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("FAIL"); // QA's own finding wins, not deferring to Evidence Guard's PASS
  });

  it("11. keyword stuffing -> overusedKeywords populated, MEDIUM issue only -> PASS", async () => {
    const client = mockClient(
      qaReportJson({
        issues: [issue({ dimension: "Keyword Overuse", description: "\"RAG testing\" repeated 9 times." })],
        overusedKeywords: ["RAG Testing"]
      })
    );

    const result = await reviewResume(
      { job: fixtureJob("04-ai-quality-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("PASS");
    expect(result.overusedKeywords).toContain("RAG Testing");
  });

  it("12. missing important keyword -> MEDIUM issue only -> PASS, keyword never invented", async () => {
    const client = mockClient(
      qaReportJson({
        issues: [issue({ dimension: "Keyword Quality", description: "Missing 'vector database' keyword." })],
        missingImportantKeywords: ["Vector Database"]
      })
    );

    const result = await reviewResume(
      { job: fixtureJob("04-ai-quality-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("PASS");
    expect(result.missingImportantKeywords).toContain("Vector Database");
    expect(result.unsupportedKeywords).not.toContain("Vector Database");
  });

  it("13. seniority mismatch -> HIGH issue -> REVIEW_REQUIRED", async () => {
    const client = mockClient(
      qaReportJson({
        claudeStatus: "REVIEW_REQUIRED",
        issues: [issue({ severity: "HIGH", dimension: "Seniority Alignment", description: "Resume undersells Principal-level architecture ownership relative to JD expectations." })]
      })
    );

    const result = await reviewResume(
      { job: fixtureJob("03-qa-architect.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.humanReviewRequired).toBe(true);
  });

  it("14. repetitive resume -> MEDIUM issue only -> PASS", async () => {
    const client = mockClient(
      qaReportJson({ issues: [issue({ dimension: "Repetition", description: "Several bullets repeat the same phrasing." })] })
    );

    const result = await reviewResume(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("PASS");
  });

  it("15. invalid Claude JSON -> InvalidClaudeResponseError", async () => {
    const client = mockClient("Here's my QA review, written in prose.");

    await expect(
      reviewResume(
        { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
        { claudeClient: client }
      )
    ).rejects.toBeInstanceOf(InvalidClaudeResponseError);
  });

  it("16. schema validation failure -> ClaudeResponseValidationError", async () => {
    const client = mockClient(JSON.stringify({ status: "MAYBE", overallScore: 1 }));

    await expect(
      reviewResume(
        { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
        { claudeClient: client }
      )
    ).rejects.toBeInstanceOf(ClaudeResponseValidationError);
  });

  it("17. empty resume (invalid tailoredResume) -> InvalidQAInputError, Claude never called", async () => {
    const client = mockClient(qaReportJson({ issues: [] }));

    await expect(
      reviewResume(
        { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: { tailoredResume: "" }, evidenceGuardResult: passingEvidenceGuardResult() },
        { claudeClient: client }
      )
    ).rejects.toBeInstanceOf(InvalidQAInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("18. empty JD (invalid job) -> InvalidQAInputError, Claude never called", async () => {
    const client = mockClient(qaReportJson({ issues: [] }));

    await expect(
      reviewResume(
        { job: { jobTitle: "" }, careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
        { claudeClient: client }
      )
    ).rejects.toBeInstanceOf(InvalidQAInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("19. missing career profile -> InvalidQAInputError, Claude never called", async () => {
    const client = mockClient(qaReportJson({ issues: [] }));

    await expect(
      reviewResume(
        { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile: {}, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
        { claudeClient: client }
      )
    ).rejects.toBeInstanceOf(InvalidQAInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("20. missing master resume -> InvalidQAInputError, Claude never called", async () => {
    const client = mockClient(qaReportJson({ issues: [] }));

    await expect(
      reviewResume(
        { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume: "", tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
        { claudeClient: client }
      )
    ).rejects.toBeInstanceOf(InvalidQAInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });
});

describe("resumeQAService — additional input validation", () => {
  it("throws InvalidQAInputError for an invalid evidence guard result, without calling Claude", async () => {
    const client = mockClient(qaReportJson({ issues: [] }));

    await expect(
      reviewResume(
        { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: { status: "BOGUS" } },
        { claudeClient: client }
      )
    ).rejects.toBeInstanceOf(InvalidQAInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("throws InvalidQAInputError for an undefined evidence guard result", async () => {
    const client = mockClient(qaReportJson({ issues: [] }));
    await expect(
      reviewResume(
        { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: undefined },
        { claudeClient: client }
      )
    ).rejects.toBeInstanceOf(InvalidQAInputError);
  });
});

describe("resumeQAService — deterministic decision enforcement", () => {
  it("forces FAIL when a CRITICAL issue exists, even if Claude self-reported PASS", async () => {
    const client = mockClient(
      qaReportJson({
        claudeStatus: "PASS", // Claude contradicts its own critical issue — service must not trust this
        issues: [issue({ severity: "CRITICAL", description: "Fabricated certification." })]
      })
    );

    const result = await reviewResume(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("FAIL");
  });

  it("never lets humanReviewRequired be false when a HIGH issue exists, even if Claude self-reported false", async () => {
    const badJson = JSON.stringify({
      ...JSON.parse(qaReportJson({ claudeStatus: "REVIEW_REQUIRED", issues: [issue({ severity: "HIGH" })] })),
      humanReviewRequired: false // Claude contradicts itself — service must override
    });
    const client = mockClient(badJson);

    const result = await reviewResume(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.humanReviewRequired).toBe(true);
  });

  it("re-buckets an issue by its own severity field, even if Claude placed it in the wrong array", async () => {
    const misplacedJson = JSON.stringify({
      status: "PASS",
      overallScore: 90,
      jdAlignmentScore: 90,
      factualAccuracyScore: 90,
      interviewReadinessScore: 90,
      // Issue says CRITICAL but Claude (incorrectly) put it in mediumIssues.
      criticalIssues: [],
      highIssues: [],
      mediumIssues: [issue({ severity: "CRITICAL", description: "Misplaced critical issue." })],
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
    const client = mockClient(misplacedJson);

    const result = await reviewResume(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.mediumIssues).toHaveLength(0);
    expect(result.criticalIssues).toHaveLength(1);
    expect(result.criticalIssues[0].description).toBe("Misplaced critical issue.");
    expect(result.status).toBe("FAIL"); // reflects the real severity, not Claude's mislabeled bucket/status
  });

  it("respects Claude's REVIEW_REQUIRED judgment when no critical/high issues exist", async () => {
    const client = mockClient(qaReportJson({ claudeStatus: "REVIEW_REQUIRED", issues: [issue({ severity: "LOW" })] }));

    const result = await reviewResume(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("respects a Claude-issued FAIL for a HIGH-only issue set (no critical) rather than forcing REVIEW_REQUIRED", async () => {
    const client = mockClient(
      qaReportJson({ claudeStatus: "FAIL", issues: [issue({ severity: "HIGH", description: "Serious unsupported claim, judged disqualifying." })] })
    );

    const result = await reviewResume(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume, tailoredResume: tailoredResume(), evidenceGuardResult: passingEvidenceGuardResult() },
      { claudeClient: client }
    );

    expect(result.status).toBe("FAIL");
  });
});
