import { describe, expect, it } from "vitest";
import { ResumeQAReportSchema, JD_ALIGNMENT_SCORE_LABEL } from "../../src/schemas/resumeQA.js";

function validReport() {
  return {
    status: "PASS",
    overallScore: 85,
    jdAlignmentScore: 80,
    factualAccuracyScore: 95,
    interviewReadinessScore: 82,
    criticalIssues: [],
    highIssues: [],
    mediumIssues: [
      { severity: "MEDIUM", dimension: "Keyword Quality", description: "Missing a relevant keyword.", evidence: "JD mentions X, resume doesn't." }
    ],
    lowIssues: [],
    strengths: ["Strong RAG testing narrative."],
    mandatoryRequirements: [
      { requirement: "RAG testing experience", evidence: "Master resume confirms this.", matchType: "DIRECT_MATCH" }
    ],
    preferredRequirements: [],
    supportedKeywords: ["RAG Testing"],
    missingImportantKeywords: [],
    unsupportedKeywords: [],
    overusedKeywords: [],
    unsupportedClaims: [],
    transferableClaims: [],
    recommendations: ["Consider adding a metric to the summary."],
    humanReviewRequired: false
  };
}

describe("ResumeQAReportSchema", () => {
  it("accepts a well-formed report", () => {
    expect(ResumeQAReportSchema.safeParse(validReport()).success).toBe(true);
  });

  it("rejects an invalid status value", () => {
    const result = ResumeQAReportSchema.safeParse({ ...validReport(), status: "MAYBE" });
    expect(result.success).toBe(false);
  });

  it("rejects a score above 100", () => {
    const result = ResumeQAReportSchema.safeParse({ ...validReport(), overallScore: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer score", () => {
    const result = ResumeQAReportSchema.safeParse({ ...validReport(), jdAlignmentScore: 50.5 });
    expect(result.success).toBe(false);
  });

  it("rejects an issue with an invalid severity", () => {
    const data = validReport();
    data.mediumIssues = [{ severity: "URGENT" as never, dimension: "X", description: "Y", evidence: "Z" }];
    expect(ResumeQAReportSchema.safeParse(data).success).toBe(false);
  });

  it("rejects a requirement with an invalid matchType", () => {
    const data = validReport();
    data.mandatoryRequirements = [{ requirement: "x", evidence: "y", matchType: "SORTA" as never }];
    expect(ResumeQAReportSchema.safeParse(data).success).toBe(false);
  });

  it("rejects a claim with an invalid classification", () => {
    const data = validReport();
    data.unsupportedClaims = [{ claim: "x", sourceLocation: "y", evidence: "z", classification: "IFFY" as never }];
    expect(ResumeQAReportSchema.safeParse(data).success).toBe(false);
  });

  it("accepts every array empty except the required boolean/status/score fields", () => {
    const data = {
      status: "PASS",
      overallScore: 100,
      jdAlignmentScore: 100,
      factualAccuracyScore: 100,
      interviewReadinessScore: 100,
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
    };
    expect(ResumeQAReportSchema.safeParse(data).success).toBe(true);
  });

  it("rejects a response missing a required top-level field", () => {
    const data = validReport() as Record<string, unknown>;
    delete data.humanReviewRequired;
    expect(ResumeQAReportSchema.safeParse(data).success).toBe(false);
  });

  it("exposes the fixed 'JD Alignment Score' label — never an ATS score", () => {
    expect(JD_ALIGNMENT_SCORE_LABEL).toBe("JD Alignment Score");
  });
});
