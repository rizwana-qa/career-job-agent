import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { verifyResumeEvidenceReport } from "../../src/services/resumeEvidenceService.js";
import { TailoredResumeSchema, type TailoredResume } from "../../src/schemas/tailoredResume.js";
import { InvalidEvidenceInputError, ClaudeResponseValidationError, InvalidClaudeResponseError } from "../../src/utils/errors.js";

const careerProfile = {
  professionalTitle: "Principal Software Quality Engineer | AI, RAG and LLM Testing Specialist",
  ragSkills: "RAG platform testing — retrieval accuracy, hallucination detection, vector database validation",
  automation: "Playwright (API and UI) automation framework design, CI-ready structure",
  leadership: "Own test strategy for banking and fintech environments; lead process improvements",
  achievements: "35 to 40% reduction in production defects; 60% test coverage"
};

const masterResume =
  "Rizwana Zahoor — Principal Quality Assurance Engineer, Clustox. " +
  "Tested a RAG based AI coaching platform, validating retrieval accuracy and hallucination detection. " +
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

function claim(overrides: Record<string, unknown> = {}) {
  return {
    claim: "Tested a RAG based AI coaching platform.",
    sourceLocation: "professionalSummary",
    evidence: "Master resume states this directly.",
    classification: "SUPPORTED",
    ...overrides
  };
}

function evidenceReportJson(claims: Record<string, unknown>[], recommendations: string[] = []) {
  const buckets: Record<string, Record<string, unknown>[]> = {
    supportedClaims: [],
    transferableClaims: [],
    potentiallyUnsupportedClaims: [],
    unsupportedClaims: [],
    unknownClaims: []
  };
  const bucketKey: Record<string, string> = {
    SUPPORTED: "supportedClaims",
    TRANSFERABLE: "transferableClaims",
    POTENTIALLY_UNSUPPORTED: "potentiallyUnsupportedClaims",
    UNSUPPORTED: "unsupportedClaims",
    UNKNOWN: "unknownClaims"
  };
  for (const c of claims) {
    buckets[bucketKey[c.classification as string]].push(c);
  }
  const hasIssue = claims.some((c) => c.classification === "UNSUPPORTED" || c.classification === "POTENTIALLY_UNSUPPORTED");
  return JSON.stringify({
    status: hasIssue ? "REVIEW_REQUIRED" : "PASS",
    evidenceScore: 0, // deliberately wrong — service must recompute this, never trust it
    claimsReviewed: 0, // deliberately wrong — service must recompute this, never trust it
    ...buckets,
    recommendations
  });
}

function mockClient(responseText: string): Anthropic {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: responseText }] }));
  return { messages: { create } } as unknown as Anthropic;
}

describe("resumeEvidenceService — 10 required scenarios", () => {
  it("1. fully supported resume -> status PASS, evidenceScore 100", async () => {
    const client = mockClient(
      evidenceReportJson([
        claim({ claim: "Tested a RAG based AI coaching platform." }),
        claim({ claim: "Built AI-assisted Playwright automation.", sourceLocation: "tailoredResume" })
      ])
    );

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.status).toBe("PASS");
    expect(result.evidenceScore).toBe(100);
    expect(result.claimsReviewed).toBe(2);
  });

  it("2. invented metric -> classified POTENTIALLY_UNSUPPORTED -> REVIEW_REQUIRED", async () => {
    const client = mockClient(
      evidenceReportJson([
        claim({
          claim: "Reduced production defects by 70%.",
          evidence: "Master resume only supports a 35 to 40% reduction — this overstates it.",
          classification: "POTENTIALLY_UNSUPPORTED"
        })
      ])
    );

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume({ tailoredResume: "Reduced production defects by 70%." }) },
      { claudeClient: client }
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.potentiallyUnsupportedClaims).toHaveLength(1);
  });

  it("3. invented responsibility -> classified UNSUPPORTED -> REVIEW_REQUIRED", async () => {
    const client = mockClient(
      evidenceReportJson([
        claim({
          claim: "Directly managed a team of 40 QA engineers across three continents.",
          sourceLocation: "experience[0].bullets[0]",
          evidence: "No mention of this in the Master Resume or Career Profile.",
          classification: "UNSUPPORTED"
        })
      ])
    );

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.unsupportedClaims[0].claim).toContain("40 QA engineers");
  });

  it("4. invented technology -> classified UNSUPPORTED -> REVIEW_REQUIRED", async () => {
    const client = mockClient(
      evidenceReportJson([
        claim({
          claim: "Extensive hands-on Kubernetes orchestration experience.",
          evidence: "No mention of Kubernetes anywhere in the source material.",
          classification: "UNSUPPORTED"
        })
      ])
    );

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.unsupportedClaims).toHaveLength(1);
  });

  it("5. invented certification -> classified UNSUPPORTED -> REVIEW_REQUIRED", async () => {
    const client = mockClient(
      evidenceReportJson([
        claim({
          claim: "Certified Kubernetes Administrator (CKA).",
          sourceLocation: "tailoredResume",
          evidence: "No certification of this kind appears in the Master Resume or Career Profile.",
          classification: "UNSUPPORTED"
        })
      ])
    );

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("6. transferable skill -> classified TRANSFERABLE -> status stays PASS", async () => {
    const client = mockClient(
      evidenceReportJson([
        claim({
          claim: "Experience evaluating LLM output quality with structured eval frameworks.",
          evidence: "Master resume shows RAG/hallucination testing, a related but not identical practice.",
          classification: "TRANSFERABLE"
        })
      ])
    );

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.status).toBe("PASS");
    expect(result.transferableClaims).toHaveLength(1);
  });

  it("7. reworded legitimate achievement -> still classified SUPPORTED -> PASS", async () => {
    const client = mockClient(
      evidenceReportJson([
        claim({
          claim: "Cut production defect rates by roughly a third to two-fifths.",
          evidence: "Matches the master resume's stated 35 to 40% reduction, just reworded.",
          classification: "SUPPORTED"
        })
      ])
    );

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.status).toBe("PASS");
    expect(result.supportedClaims).toHaveLength(1);
  });

  it("8. stronger wording that changes the meaning -> POTENTIALLY_UNSUPPORTED -> REVIEW_REQUIRED", async () => {
    const client = mockClient(
      evidenceReportJson([
        claim({
          claim: "Single-handedly transformed the entire company's quality culture.",
          evidence: "Master resume describes leading process improvements within a team, not a company-wide transformation.",
          classification: "POTENTIALLY_UNSUPPORTED"
        })
      ])
    );

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("9. unsupported AI experience -> classified UNSUPPORTED -> REVIEW_REQUIRED", async () => {
    const client = mockClient(
      evidenceReportJson([
        claim({
          claim: "Built and fine-tuned custom large language models from scratch.",
          evidence: "Master resume shows RAG/agentic QA testing, not LLM training or fine-tuning.",
          classification: "UNSUPPORTED"
        })
      ])
    );

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("10. unsupported leadership claim -> classified UNSUPPORTED -> REVIEW_REQUIRED", async () => {
    const client = mockClient(
      evidenceReportJson([
        claim({
          claim: "Served as VP of Engineering overseeing the entire quality organization.",
          evidence: "Master resume shows Principal QA Engineer (senior IC), not a VP-level title.",
          classification: "UNSUPPORTED"
        })
      ])
    );

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
  });
});

describe("resumeEvidenceService — input validation", () => {
  it("throws InvalidEvidenceInputError for an empty master resume, without calling Claude", async () => {
    const client = mockClient(evidenceReportJson([claim()]));
    await expect(
      verifyResumeEvidenceReport({ masterResume: "", careerProfile, tailoredResume: tailoredResume() }, { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidEvidenceInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("throws InvalidEvidenceInputError for a whitespace-only master resume", async () => {
    const client = mockClient(evidenceReportJson([claim()]));
    await expect(
      verifyResumeEvidenceReport({ masterResume: "   ", careerProfile, tailoredResume: tailoredResume() }, { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidEvidenceInputError);
  });

  it("throws InvalidEvidenceInputError for an empty career profile, without calling Claude", async () => {
    const client = mockClient(evidenceReportJson([claim()]));
    await expect(
      verifyResumeEvidenceReport({ masterResume, careerProfile: {}, tailoredResume: tailoredResume() }, { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidEvidenceInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("throws InvalidEvidenceInputError for an invalid/missing tailored resume, without calling Claude", async () => {
    const client = mockClient(evidenceReportJson([claim()]));
    await expect(
      verifyResumeEvidenceReport({ masterResume, careerProfile, tailoredResume: { tailoredResume: "" } }, { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidEvidenceInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("throws InvalidEvidenceInputError for an undefined tailored resume", async () => {
    const client = mockClient(evidenceReportJson([claim()]));
    await expect(
      verifyResumeEvidenceReport({ masterResume, careerProfile, tailoredResume: undefined }, { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidEvidenceInputError);
  });
});

describe("resumeEvidenceService — Claude response failures", () => {
  it("propagates InvalidClaudeResponseError for non-JSON Claude output", async () => {
    const client = mockClient("Here's my assessment, in prose.");
    await expect(
      verifyResumeEvidenceReport({ masterResume, careerProfile, tailoredResume: tailoredResume() }, { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidClaudeResponseError);
  });

  it("propagates ClaudeResponseValidationError for a schema-invalid response", async () => {
    const client = mockClient(JSON.stringify({ status: "MAYBE", evidenceScore: 1, claimsReviewed: 0, supportedClaims: [], transferableClaims: [], potentiallyUnsupportedClaims: [], unsupportedClaims: [], unknownClaims: [], recommendations: [] }));
    await expect(
      verifyResumeEvidenceReport({ masterResume, careerProfile, tailoredResume: tailoredResume() }, { claudeClient: client })
    ).rejects.toBeInstanceOf(ClaudeResponseValidationError);
  });
});

describe("resumeEvidenceService — deterministic recomputation", () => {
  it("never trusts Claude's own evidenceScore/claimsReviewed — always recomputes them", async () => {
    // evidenceReportJson() deliberately sends evidenceScore: 0, claimsReviewed: 0
    // regardless of how many claims are actually present.
    const client = mockClient(evidenceReportJson([claim(), claim({ classification: "TRANSFERABLE" })]));

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.claimsReviewed).toBe(2);
    expect(result.evidenceScore).toBe(50); // 1 of 2 claims SUPPORTED
  });

  it("re-buckets a claim by its own classification field, even if Claude placed it in the wrong array", async () => {
    const misplacedJson = JSON.stringify({
      status: "PASS",
      evidenceScore: 0,
      claimsReviewed: 0,
      // Claim says UNSUPPORTED but Claude (incorrectly) put it in supportedClaims.
      supportedClaims: [claim({ classification: "UNSUPPORTED", claim: "Misplaced claim." })],
      transferableClaims: [],
      potentiallyUnsupportedClaims: [],
      unsupportedClaims: [],
      unknownClaims: [],
      recommendations: []
    });
    const client = mockClient(misplacedJson);

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.supportedClaims).toHaveLength(0);
    expect(result.unsupportedClaims).toHaveLength(1);
    expect(result.unsupportedClaims[0].claim).toBe("Misplaced claim.");
    expect(result.status).toBe("REVIEW_REQUIRED"); // correctly reflects the real classification, not Claude's mislabeled status
  });

  it("treats zero extracted claims as PASS with evidenceScore 100 (vacuous case)", async () => {
    const client = mockClient(evidenceReportJson([]));

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.claimsReviewed).toBe(0);
    expect(result.evidenceScore).toBe(100);
    expect(result.status).toBe("PASS");
  });

  it("passes through recommendations from Claude unchanged", async () => {
    const client = mockClient(evidenceReportJson([claim()], ["Verify the exact defect-reduction percentage before submitting."]));

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result.recommendations).toEqual(["Verify the exact defect-reduction percentage before submitting."]);
  });

  it("does not rewrite or modify the tailored resume itself — the service never returns resume text", async () => {
    const client = mockClient(evidenceReportJson([claim()]));

    const result = await verifyResumeEvidenceReport(
      { masterResume, careerProfile, tailoredResume: tailoredResume() },
      { claudeClient: client }
    );

    expect(result).not.toHaveProperty("tailoredResume");
    expect(result).not.toHaveProperty("professionalSummary");
  });
});
