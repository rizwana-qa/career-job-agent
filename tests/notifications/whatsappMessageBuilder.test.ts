import { describe, expect, it } from "vitest";
import { buildWhatsAppMessage } from "../../src/notifications/whatsappMessageBuilder.js";
import { ApplicationPackageSchema, type ApplicationPackage } from "../../src/schemas/applicationPackage.js";
import { TailoredResumeSchema } from "../../src/schemas/tailoredResume.js";

function tailoredResume(overrides: Record<string, unknown> = {}) {
  return TailoredResumeSchema.parse({
    jobId: "job-1",
    targetRole: "AI Quality Engineer",
    targetCompany: "Vantage AI",
    professionalSummary: "Principal QA leader with RAG testing experience — CONFIDENTIAL FULL SUMMARY TEXT.",
    coreSkills: ["RAG Testing"],
    experience: [
      {
        title: "Principal QA Engineer",
        company: "Clustox",
        dates: "2022-Present",
        bullets: ["CONFIDENTIAL EXPERIENCE BULLET — full resume detail that must never leave this object."]
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
    tailoredResume: "FULL TAILORED RESUME TEXT — CONFIDENTIAL, MUST NEVER APPEAR IN A WHATSAPP MESSAGE.",
    status: "READY_FOR_RESUME_QA",
    ...overrides
  });
}

function pkg(overrides: Record<string, unknown> = {}): ApplicationPackage {
  return ApplicationPackageSchema.parse({
    applicationId: "app-1",
    status: "READY_FOR_REVIEW",
    jobId: "job-1",
    company: "Vantage AI",
    role: "AI Quality Engineer",
    source: "remotive",
    sourceUrl: "https://remotive.com/remote-jobs/qa/job-1",
    matchScore: 82,
    resumeVersion: "AI_QUALITY_ENGINEER_VANTAGE_AI_20260815",
    qaStatus: "PASS",
    applicationStatus: "READY_FOR_REVIEW",
    job: {
      jobTitle: "AI Quality Engineer",
      company: "Vantage AI",
      location: "Worldwide",
      country: "Worldwide",
      remoteStatus: "REMOTE",
      sourceUrl: "https://remotive.com/remote-jobs/qa/job-1",
      salary: 165000,
      currency: "USD"
    },
    jobMatch: {
      matchScore: 82,
      matchScoreLabel: "Estimated Application Match Score",
      interviewPotential: 70,
      careerGrowth: 65,
      strongMatches: [{ statement: "Candidate has RAG testing experience.", evidence: "FACT" }],
      transferableSkills: [],
      gaps: [{ statement: "No evidenced Python experience.", evidence: "FACT" }]
    },
    resume: { ...tailoredResume(), resumeVersion: "AI_QUALITY_ENGINEER_VANTAGE_AI_20260815" },
    resumeQA: {
      status: "PASS",
      jdAlignmentScore: 80,
      factualAccuracyScore: 95,
      interviewReadinessScore: 82,
      importantKeywords: ["RAG Testing"],
      missingKeywords: []
    },
    applicationMessage: "CONFIDENTIAL DRAFTED OUTREACH MESSAGE — must never appear in a WhatsApp notification.",
    applicationMessageUnsupportedClaims: [],
    createdAt: "2026-08-15T00:00:00.000Z",
    ...overrides
  });
}

describe("buildWhatsAppMessage — message generation", () => {
  it("generates a message starting with the CAREER AGENT header", () => {
    const text = buildWhatsAppMessage([pkg()]);
    expect(text).toMatch(/^CAREER AGENT/);
  });

  it("includes the opportunity count", () => {
    const text = buildWhatsAppMessage([pkg(), pkg({ jobId: "job-2" })]);
    expect(text).toContain("2 opportunities found");
  });

  it("uses singular wording for exactly one opportunity", () => {
    const text = buildWhatsAppMessage([pkg()]);
    expect(text).toContain("1 opportunity found");
  });
});

describe("buildWhatsAppMessage — top job formatting", () => {
  it("includes role, company, location, remote status, and scores", () => {
    const text = buildWhatsAppMessage([pkg()]);
    expect(text).toContain("1. AI Quality Engineer");
    expect(text).toContain("Vantage AI");
    expect(text).toContain("Worldwide");
    expect(text).toContain("REMOTE");
    expect(text).toContain("Match Score: 82/100 (Estimated Application Match Score)");
    expect(text).toContain("Interview Potential: 70/100");
    expect(text).toContain("Career Value: 65/100");
  });

  it("includes strong-match and gap bullets, capped at 3", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ statement: `Match reason ${i}`, evidence: "FACT" as const }));
    const text = buildWhatsAppMessage([
      pkg({ jobMatch: { matchScore: 82, matchScoreLabel: "x", interviewPotential: 70, careerGrowth: 65, strongMatches: many, transferableSkills: [], gaps: [] } })
    ]);
    expect(text).toContain("Match reason 0");
    expect(text).toContain("Match reason 2");
    expect(text).not.toContain("Match reason 3");
    expect(text).not.toContain("Match reason 4");
  });

  it("shows a placeholder when there are no strong matches or gaps", () => {
    const text = buildWhatsAppMessage([
      pkg({ jobMatch: { matchScore: 82, matchScoreLabel: "x", interviewPotential: 70, careerGrowth: 65, strongMatches: [], transferableSkills: [], gaps: [] } })
    ]);
    expect(text).toContain("(none identified)");
  });

  it("includes Resume QA status, Application Package status, and the job URL", () => {
    const text = buildWhatsAppMessage([pkg()]);
    expect(text).toContain("Resume QA: PASS");
    expect(text).toContain("Application Package: READY_FOR_REVIEW");
    expect(text).toContain("Job URL: https://remotive.com/remote-jobs/qa/job-1");
  });
});

describe("buildWhatsAppMessage — salary handling", () => {
  it("shows the real salary and currency when disclosed", () => {
    const text = buildWhatsAppMessage([pkg({ job: { jobTitle: "x", company: "x", location: "x", country: "x", remoteStatus: "REMOTE", sourceUrl: "https://example.com", salary: 100000, currency: "USD" } })]);
    expect(text).toContain("Salary: 100,000 USD");
  });

  it("shows UNKNOWN rather than a fabricated number when salary is UNKNOWN", () => {
    const text = buildWhatsAppMessage([pkg({ job: { jobTitle: "x", company: "x", location: "x", country: "x", remoteStatus: "REMOTE", sourceUrl: "https://example.com", salary: "UNKNOWN", currency: "UNKNOWN" } })]);
    expect(text).toContain("Salary: UNKNOWN");
    expect(text).not.toMatch(/Salary: \d/);
  });
});

describe("buildWhatsAppMessage — defensive formatting", () => {
  it("falls back to a placeholder when location is an empty string", () => {
    const text = buildWhatsAppMessage([pkg({ job: { jobTitle: "x", company: "Acme", location: "", country: "x", remoteStatus: "REMOTE", sourceUrl: "https://example.com", salary: "UNKNOWN", currency: "UNKNOWN" } })]);
    expect(text).toContain("Location not specified");
  });

  it("falls back to a placeholder when company is an empty string", () => {
    const text = buildWhatsAppMessage([pkg({ company: "" })]);
    expect(text).toContain("Company not specified");
  });

  it("falls back to a placeholder when role is an empty string", () => {
    const text = buildWhatsAppMessage([pkg({ role: "" })]);
    expect(text).toContain("Role not specified");
  });
});

describe("buildWhatsAppMessage — multiple jobs", () => {
  it("numbers each opportunity and separates them with a divider", () => {
    const text = buildWhatsAppMessage([pkg({ jobId: "1", role: "Role One" }), pkg({ jobId: "2", role: "Role Two" }), pkg({ jobId: "3", role: "Role Three" })]);
    expect(text).toContain("1. Role One");
    expect(text).toContain("2. Role Two");
    expect(text).toContain("3. Role Three");
    expect(text).toContain("------------------------------------------------");
  });
});

describe("buildWhatsAppMessage — empty job list", () => {
  it("returns a graceful message rather than throwing or producing an empty string", () => {
    const text = buildWhatsAppMessage([]);
    expect(text).toContain("CAREER AGENT");
    expect(text).toContain("No new opportunities");
  });
});

describe("buildWhatsAppMessage — sensitive information filtering", () => {
  it("never includes the full tailored resume text", () => {
    const text = buildWhatsAppMessage([pkg()]);
    expect(text).not.toContain("FULL TAILORED RESUME TEXT");
  });

  it("never includes full experience bullet detail", () => {
    const text = buildWhatsAppMessage([pkg()]);
    expect(text).not.toContain("CONFIDENTIAL EXPERIENCE BULLET");
  });

  it("never includes the drafted application message", () => {
    const text = buildWhatsAppMessage([pkg()]);
    expect(text).not.toContain("CONFIDENTIAL DRAFTED OUTREACH MESSAGE");
  });

  it("never includes the professional summary", () => {
    const text = buildWhatsAppMessage([pkg()]);
    expect(text).not.toContain("CONFIDENTIAL FULL SUMMARY TEXT");
  });
});
