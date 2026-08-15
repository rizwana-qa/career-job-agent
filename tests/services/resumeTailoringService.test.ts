import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  calculateJdKeywordAlignment,
  findUnsupportedClaims,
  tailorResumeForJob
} from "../../src/services/resumeTailoringService.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";
import { InvalidTailoringInputError, ClaudeResponseValidationError, InvalidClaudeResponseError } from "../../src/utils/errors.js";
import { loadJobFixture } from "../helpers/fixtures.js";

const careerProfile = {
  professionalTitle: "Principal Software Quality Engineer | AI, RAG and LLM Testing Specialist",
  coreSkills: "Playwright, API Testing, SQL",
  ragSkills: "RAG platform testing — retrieval accuracy, hallucination detection, vector database validation",
  automation: "Playwright (API and UI) automation framework design, CI-ready structure",
  leadership: "Own test strategy for banking and fintech environments; lead process improvements",
  achievements: "35 to 40% reduction in production defects; 60% test coverage",
  certifications: "Claude Code 101 (Anthropic, 2026); Scrum Fundamentals Certified (2021)",
  education: "Master of Science in Software Engineering (2011)"
};

const masterResume =
  "Rizwana Zahoor — Principal Quality Assurance Engineer, Clustox. " +
  "Tested a RAG based AI coaching platform, validating retrieval accuracy and hallucination detection " +
  "as part of hands-on RAG Testing work. " +
  "Built AI-assisted Playwright automation covering UI and API testing. " +
  "Own test strategy, API and backend validation for banking and fintech environments. " +
  "Achieved a 35 to 40% reduction in production defects. " +
  "Certifications: Claude Code 101 (Anthropic, 2026), Scrum Fundamentals Certified (2021). " +
  "Master of Science in Software Engineering (2011).";

function baseTailoredResumeFields(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "placeholder",
    targetRole: "placeholder",
    targetCompany: "placeholder",
    professionalSummary: "Principal QA leader with RAG and agentic QA automation experience.",
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
      { requirement: "RAG testing", evidence: "Tested RAG based AI coaching platform", matchType: "DIRECT_MATCH" }
    ],
    transferableRequirements: [],
    gaps: [],
    keywordsAdded: ["RAG Testing"],
    changesMade: ["Reordered core skills to lead with RAG testing"],
    claimsRequiringVerification: [],
    tailoredResume: "Full tailored resume text describing the candidate's real, relevant experience.",
    status: "READY_FOR_RESUME_QA",
    ...overrides
  };
}

function mockClient(responseText: string | (() => string)): Anthropic {
  const create = vi.fn(async () => ({
    content: [{ type: "text", text: typeof responseText === "function" ? responseText() : responseText }]
  }));
  return { messages: { create } } as unknown as Anthropic;
}

function fixtureJob(filename: string): unknown {
  return loadJobFixture(filename);
}

describe("resumeTailoringService.tailorResumeForJob — normal / flavor-specific JDs", () => {
  it("tailors a resume for a normal (direct-fit) JD", async () => {
    const client = mockClient(JSON.stringify(baseTailoredResumeFields()));

    const result = await tailorResumeForJob(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume },
      { claudeClient: client }
    );

    expect(result.status).toBe("READY_FOR_RESUME_QA");
    expect(result.targetRole).toBe("Principal QA Engineer");
    expect(result.targetCompany).toBe("Meridian Fintech");
    expect(result.jobId).toBe("MER-QA-PRIN-001");
  });

  it("tailors a resume for an AI-focused JD", async () => {
    const client = mockClient(
      JSON.stringify(
        baseTailoredResumeFields({
          professionalSummary: "Principal QA leader specializing in RAG and hallucination-detection testing.",
          coreSkills: ["RAG Testing", "Hallucination Detection", "Vector Databases"]
        })
      )
    );

    const result = await tailorResumeForJob(
      { job: fixtureJob("04-ai-quality-engineer.json"), careerProfile, masterResume },
      { claudeClient: client }
    );

    expect(result.targetRole).toBe("AI Quality Engineer");
    expect(result.coreSkills).toContain("RAG Testing");
  });

  it("tailors a resume for an automation-focused JD", async () => {
    const client = mockClient(
      JSON.stringify(baseTailoredResumeFields({ coreSkills: ["Playwright", "Test Automation Architecture"] }))
    );

    const result = await tailorResumeForJob(
      { job: fixtureJob("09-automation-architect.json"), careerProfile, masterResume },
      { claudeClient: client }
    );

    expect(result.targetRole).toBe("Automation Architect");
  });

  it("tailors a resume for a leadership-focused JD", async () => {
    const client = mockClient(
      JSON.stringify(baseTailoredResumeFields({ professionalSummary: "Quality engineering leader driving strategy and governance." }))
    );

    const result = await tailorResumeForJob(
      { job: fixtureJob("08-quality-engineering-lead.json"), careerProfile, masterResume },
      { claudeClient: client }
    );

    expect(result.targetRole).toBe("Quality Engineering Lead");
  });

  it("handles a very long job description without failing", async () => {
    const longDescriptionJob = fixtureJob("01-principal-qa-engineer.json") as Record<string, unknown>;
    longDescriptionJob.jobDescription = (longDescriptionJob.jobDescription as string).repeat(200); // ~40k+ chars
    const client = mockClient(JSON.stringify(baseTailoredResumeFields()));

    const result = await tailorResumeForJob({ job: longDescriptionJob, careerProfile, masterResume }, { claudeClient: client });
    expect(result.status).toBe("READY_FOR_RESUME_QA");
  });
});

describe("resumeTailoringService.tailorResumeForJob — missing/invalid inputs", () => {
  it("throws InvalidTailoringInputError for a missing/invalid job, without calling Claude", async () => {
    const client = mockClient(JSON.stringify(baseTailoredResumeFields()));

    await expect(
      tailorResumeForJob({ job: { jobTitle: "Broken" }, careerProfile, masterResume }, { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidTailoringInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("throws InvalidTailoringInputError for an undefined job", async () => {
    const client = mockClient(JSON.stringify(baseTailoredResumeFields()));
    await expect(
      tailorResumeForJob({ job: undefined, careerProfile, masterResume }, { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidTailoringInputError);
  });

  it("throws InvalidTailoringInputError for an empty master resume, without calling Claude", async () => {
    const client = mockClient(JSON.stringify(baseTailoredResumeFields()));

    await expect(
      tailorResumeForJob({ job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume: "" }, { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidTailoringInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("throws InvalidTailoringInputError for a whitespace-only master resume", async () => {
    const client = mockClient(JSON.stringify(baseTailoredResumeFields()));
    await expect(
      tailorResumeForJob({ job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume: "   \n  " }, { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidTailoringInputError);
  });

  it("throws InvalidTailoringInputError for an empty career profile, without calling Claude", async () => {
    const client = mockClient(JSON.stringify(baseTailoredResumeFields()));

    await expect(
      tailorResumeForJob({ job: fixtureJob("01-principal-qa-engineer.json"), careerProfile: {}, masterResume }, { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidTailoringInputError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });
});

describe("resumeTailoringService.tailorResumeForJob — Claude response failures", () => {
  it("propagates InvalidClaudeResponseError for non-JSON Claude output", async () => {
    const client = mockClient("Sure — here's the tailored resume, written out in prose.");

    await expect(
      tailorResumeForJob({ job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume }, { claudeClient: client })
    ).rejects.toBeInstanceOf(InvalidClaudeResponseError);
  });

  it("propagates ClaudeResponseValidationError for a schema-invalid response", async () => {
    const client = mockClient(JSON.stringify(baseTailoredResumeFields({ gaps: [{ requirement: "x", evidence: "y", matchType: "MAYBE" }] })));

    await expect(
      tailorResumeForJob({ job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume }, { claudeClient: client })
    ).rejects.toBeInstanceOf(ClaudeResponseValidationError);
  });

  it('propagates ClaudeResponseValidationError for the "empty resume" case (empty tailoredResume string)', async () => {
    const client = mockClient(JSON.stringify(baseTailoredResumeFields({ tailoredResume: "" })));

    await expect(
      tailorResumeForJob({ job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume }, { claudeClient: client })
    ).rejects.toBeInstanceOf(ClaudeResponseValidationError);
  });
});

describe("resumeTailoringService — deterministic hallucination safety nets", () => {
  it("flags an unsupported technology (a JD skill Claude added that isn't in the source materials) as unsupported, not supported", async () => {
    // 06-llm-evaluation-engineer.json lists "Python" among its skills; the
    // candidate's source materials here don't mention Python anywhere.
    const client = mockClient(
      JSON.stringify(baseTailoredResumeFields({ coreSkills: ["Playwright", "Python"], tailoredResume: "Experienced in Python-based automation." }))
    );

    const result = await tailorResumeForJob(
      { job: fixtureJob("06-llm-evaluation-engineer.json"), careerProfile, masterResume },
      { claudeClient: client }
    );

    expect(result.jdKeywordAlignment.unsupportedKeywords).toContain("Python");
    expect(result.jdKeywordAlignment.supportedKeywords).not.toContain("Python");
    expect(result.unsupportedClaims).toContain("Python");
  });

  it("flags an unsupported certification Claude invented as an unsupported claim", async () => {
    const client = mockClient(
      JSON.stringify(baseTailoredResumeFields({ certifications: ["Certified Kubernetes Administrator"] }))
    );

    const result = await tailorResumeForJob(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume },
      { claudeClient: client }
    );

    expect(result.unsupportedClaims).toContain("Certified Kubernetes Administrator");
  });

  it("does not flag a real, source-backed skill or certification as unsupported", async () => {
    const client = mockClient(JSON.stringify(baseTailoredResumeFields()));

    const result = await tailorResumeForJob(
      { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume },
      { claudeClient: client }
    );

    expect(result.unsupportedClaims).toEqual([]);
  });

  it(
    "KNOWN LIMITATION: does not detect a hallucinated metric embedded in free text " +
      "(e.g. an inflated percentage inside tailoredResume) — only structured coreSkills/certifications " +
      "and JD-listed skills are deterministically cross-checked; free-text claims rely on the prompt's " +
      "anti-hallucination instructions and human review before Resume QA, not on this code layer",
    async () => {
      const client = mockClient(
        JSON.stringify(
          baseTailoredResumeFields({
            tailoredResume: "Reduced production defects by 70% through redesigned test strategy." // real figure is 35-40%
          })
        )
      );

      const result = await tailorResumeForJob(
        { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume },
        { claudeClient: client }
      );

      // Documents current behavior: the pipeline succeeds and does not catch this.
      expect(result.status).toBe("READY_FOR_RESUME_QA");
      expect(result.tailoredResume).toContain("70%");
    }
  );

  it(
    "KNOWN LIMITATION: does not detect a hallucinated job responsibility embedded in an experience bullet " +
      "— same reasoning as the metric case above",
    async () => {
      const client = mockClient(
        JSON.stringify(
          baseTailoredResumeFields({
            experience: [
              {
                title: "Principal Quality Assurance Engineer",
                company: "Clustox",
                dates: "Mar 2022 to Present",
                bullets: ["Directly managed a team of 40 QA engineers across three continents."] // not in source
              }
            ]
          })
        )
      );

      const result = await tailorResumeForJob(
        { job: fixtureJob("01-principal-qa-engineer.json"), careerProfile, masterResume },
        { claudeClient: client }
      );

      expect(result.status).toBe("READY_FOR_RESUME_QA");
      expect(result.experience[0].bullets[0]).toContain("40 QA engineers");
    }
  );
});

describe("resumeTailoringService.calculateJdKeywordAlignment (unit)", () => {
  function fakeJob(skills: string[]): Job {
    return JobSchema.parse({ ...loadJobFixture("01-principal-qa-engineer.json"), skills });
  }

  it("labels the metric as 'JD Keyword Alignment', never an ATS score", () => {
    const result = calculateJdKeywordAlignment(
      fakeJob(["Playwright"]),
      { professionalSummary: "Uses Playwright.", coreSkills: [], tailoredResume: "" },
      "Playwright automation experience."
    );
    expect(result.label).toBe("JD Keyword Alignment");
  });

  it("computes 100 when every JD skill is supported by source text", () => {
    const result = calculateJdKeywordAlignment(
      fakeJob(["Playwright", "SQL"]),
      { professionalSummary: "", coreSkills: [], tailoredResume: "" },
      "Playwright and SQL experience."
    );
    expect(result.score).toBe(100);
    expect(result.supportedKeywords).toEqual(["Playwright", "SQL"]);
  });

  it("computes 0 and lists missing keywords when nothing is supported", () => {
    const result = calculateJdKeywordAlignment(
      fakeJob(["Kubernetes"]),
      { professionalSummary: "", coreSkills: [], tailoredResume: "" },
      "Playwright and SQL experience."
    );
    expect(result.score).toBe(0);
    expect(result.missingKeywords).toEqual(["Kubernetes"]);
  });

  it("never adds an unsupported keyword to the supported list just because it appears in the tailored text", () => {
    const result = calculateJdKeywordAlignment(
      fakeJob(["Kubernetes"]),
      { professionalSummary: "Kubernetes expert.", coreSkills: [], tailoredResume: "" },
      "Playwright and SQL experience only."
    );
    expect(result.supportedKeywords).not.toContain("Kubernetes");
    expect(result.unsupportedKeywords).toContain("Kubernetes");
    expect(result.score).toBe(0);
  });
});

describe("resumeTailoringService.findUnsupportedClaims (unit)", () => {
  it("returns entries not present in the source text", () => {
    const tailored = baseTailoredResumeFields({
      coreSkills: ["Playwright", "Rust"],
      certifications: ["AWS Certified Solutions Architect"]
    }) as never;

    const claims = findUnsupportedClaims(tailored, "Playwright automation and API testing experience.");
    expect(claims).toContain("Rust");
    expect(claims).toContain("AWS Certified Solutions Architect");
    expect(claims).not.toContain("Playwright");
  });

  it("returns an empty array when every claim is source-backed", () => {
    const tailored = baseTailoredResumeFields({ coreSkills: ["Playwright"], certifications: [] }) as never;
    const claims = findUnsupportedClaims(tailored, "Playwright automation experience.");
    expect(claims).toEqual([]);
  });
});
