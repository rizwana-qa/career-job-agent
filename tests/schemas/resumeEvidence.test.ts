import { describe, expect, it } from "vitest";
import { ResumeEvidenceReportSchema } from "../../src/schemas/resumeEvidence.js";

function validReport() {
  return {
    status: "PASS",
    evidenceScore: 100,
    claimsReviewed: 1,
    supportedClaims: [
      { claim: "Tested a RAG based AI platform.", sourceLocation: "professionalSummary", evidence: "Master resume states this directly.", classification: "SUPPORTED" }
    ],
    transferableClaims: [],
    potentiallyUnsupportedClaims: [],
    unsupportedClaims: [],
    unknownClaims: [],
    recommendations: []
  };
}

describe("ResumeEvidenceReportSchema", () => {
  it("accepts a well-formed report", () => {
    expect(ResumeEvidenceReportSchema.safeParse(validReport()).success).toBe(true);
  });

  it("rejects an invalid status value", () => {
    const result = ResumeEvidenceReportSchema.safeParse({ ...validReport(), status: "OK" });
    expect(result.success).toBe(false);
  });

  it("rejects an evidenceScore above 100", () => {
    const result = ResumeEvidenceReportSchema.safeParse({ ...validReport(), evidenceScore: 150 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative claimsReviewed", () => {
    const result = ResumeEvidenceReportSchema.safeParse({ ...validReport(), claimsReviewed: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid claim classification", () => {
    const data = validReport();
    data.supportedClaims = [{ claim: "x", sourceLocation: "y", evidence: "z", classification: "MAYBE" as never }];
    expect(ResumeEvidenceReportSchema.safeParse(data).success).toBe(false);
  });

  it("rejects a claim with an empty evidence field", () => {
    const data = validReport();
    data.supportedClaims = [{ claim: "x", sourceLocation: "y", evidence: "", classification: "SUPPORTED" }];
    expect(ResumeEvidenceReportSchema.safeParse(data).success).toBe(false);
  });

  it("accepts all five claim buckets empty (nothing extracted)", () => {
    const data = {
      ...validReport(),
      claimsReviewed: 0,
      supportedClaims: [],
      transferableClaims: [],
      potentiallyUnsupportedClaims: [],
      unsupportedClaims: [],
      unknownClaims: []
    };
    expect(ResumeEvidenceReportSchema.safeParse(data).success).toBe(true);
  });

  it("rejects a response missing a required top-level field", () => {
    const data = validReport() as Record<string, unknown>;
    delete data.status;
    expect(ResumeEvidenceReportSchema.safeParse(data).success).toBe(false);
  });
});
