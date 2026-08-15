import { describe, expect, it } from "vitest";
import { TailoredResumeSchema, TAILORED_RESUME_STATUS } from "../../src/schemas/tailoredResume.js";

function validTailoredResume() {
  return {
    jobId: "job-123",
    targetRole: "AI Quality Engineer",
    targetCompany: "Vantage AI",
    professionalSummary: "Principal QA leader with hands-on RAG and agentic QA automation experience.",
    coreSkills: ["Playwright", "API Testing", "RAG Testing"],
    experience: [
      {
        title: "Principal Quality Assurance Engineer",
        company: "Clustox",
        dates: "Mar 2022 to Present",
        bullets: ["Tested a RAG based AI coaching platform, validating retrieval accuracy."]
      }
    ],
    education: ["Master of Science in Software Engineering (2011)"],
    certifications: ["Claude Code 101 (Anthropic, 2026)"],
    matchedRequirements: [
      { requirement: "RAG testing experience", evidence: "Tested RAG-based AI coaching platform", matchType: "DIRECT_MATCH" }
    ],
    transferableRequirements: [
      { requirement: "Python for eval tooling", evidence: "No direct Python evidence in profile", matchType: "TRANSFERABLE" }
    ],
    gaps: [{ requirement: "LangChain experience", evidence: "Not present in master resume", matchType: "GAP" }],
    keywordsAdded: ["RAG Testing"],
    changesMade: ["Reordered core skills to lead with RAG testing"],
    claimsRequiringVerification: [],
    tailoredResume: "Full tailored resume text goes here.",
    status: "READY_FOR_RESUME_QA"
  };
}

describe("TailoredResumeSchema", () => {
  it("accepts a well-formed tailored resume", () => {
    const result = TailoredResumeSchema.safeParse(validTailoredResume());
    expect(result.success).toBe(true);
  });

  it("rejects an empty tailoredResume string (the 'empty resume' case)", () => {
    const result = TailoredResumeSchema.safeParse({ ...validTailoredResume(), tailoredResume: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty professionalSummary", () => {
    const result = TailoredResumeSchema.safeParse({ ...validTailoredResume(), professionalSummary: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid matchType", () => {
    const data = validTailoredResume();
    data.gaps = [{ requirement: "x", evidence: "y", matchType: "MAYBE" as never }];
    const result = TailoredResumeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects an experience entry with no bullets", () => {
    const data = validTailoredResume();
    data.experience = [{ title: "T", company: "C", dates: "D", bullets: [] }];
    const result = TailoredResumeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("accepts empty coreSkills/education/certifications arrays", () => {
    const data = { ...validTailoredResume(), coreSkills: [], education: [], certifications: [] };
    const result = TailoredResumeSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("accepts empty matchedRequirements/transferableRequirements/gaps arrays", () => {
    const data = { ...validTailoredResume(), matchedRequirements: [], transferableRequirements: [], gaps: [] };
    const result = TailoredResumeSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects a response missing a required field", () => {
    const data = validTailoredResume() as Record<string, unknown>;
    delete data.tailoredResume;
    const result = TailoredResumeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("exposes the fixed status constant used to overwrite whatever Claude sends", () => {
    expect(TAILORED_RESUME_STATUS).toBe("READY_FOR_RESUME_QA");
  });
});
