import { describe, expect, it } from "vitest";
import { JobMatchSchema, MATCH_SCORE_LABEL } from "../../src/schemas/jobMatch.js";

function validMatch() {
  return {
    matchScore: 82,
    interviewPotential: 70,
    careerGrowth: 60,
    futureAIValue: 75,
    recommendation: "APPLY",
    strongMatches: [{ statement: "Candidate has Playwright experience.", evidence: "FACT" }],
    transferableSkills: [
      { statement: "RAG testing experience may transfer to this role's vector DB work.", evidence: "INFERENCE" }
    ],
    gaps: [{ statement: "No evidenced Python experience.", evidence: "FACT" }],
    risks: [{ statement: "Direct experience with this specific industry system is not established.", evidence: "UNKNOWN" }],
    reason: "Strong overlap in test automation and AI/RAG testing experience."
  };
}

describe("JobMatchSchema", () => {
  it("accepts a well-formed response", () => {
    const result = JobMatchSchema.safeParse(validMatch());
    expect(result.success).toBe(true);
  });

  it("rejects a matchScore above 100", () => {
    const result = JobMatchSchema.safeParse({ ...validMatch(), matchScore: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative score", () => {
    const result = JobMatchSchema.safeParse({ ...validMatch(), interviewPotential: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer score", () => {
    const result = JobMatchSchema.safeParse({ ...validMatch(), careerGrowth: 55.5 });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid recommendation value", () => {
    const result = JobMatchSchema.safeParse({ ...validMatch(), recommendation: "MAYBE" });
    expect(result.success).toBe(false);
  });

  it("rejects an evidence statement with an invalid evidence level", () => {
    const match = validMatch();
    match.strongMatches = [{ statement: "Something", evidence: "PROBABLY" as never }];
    const result = JobMatchSchema.safeParse(match);
    expect(result.success).toBe(false);
  });

  it("rejects an empty reason", () => {
    const result = JobMatchSchema.safeParse({ ...validMatch(), reason: "" });
    expect(result.success).toBe(false);
  });

  it("exposes a fixed, code-owned label for the match score", () => {
    expect(MATCH_SCORE_LABEL).toBe("Estimated Application Match Score");
  });
});
