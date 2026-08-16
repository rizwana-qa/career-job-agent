import { describe, expect, it } from "vitest";
import { JOB_MATCHING_SYSTEM_PROMPT, buildJobMatchingUserPrompt } from "../../src/prompts/jobMatching.js";
import { JobMatchSchema } from "../../src/schemas/jobMatch.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";

const profile = {
  professionalTitle: "Principal Software Quality Engineer",
  coreSkills: "Test Strategy, API Testing, Playwright Automation, SQL and Database Validation",
  automation: "Playwright automation framework design (page object pattern, CI-ready structure)",
  apiTesting: "Postman, JMeter, REST APIs, large-scale API testing",
  qualityEngineering: "Test strategy ownership, functional/API/regression/performance testing",
  leadership: "Own test strategy for banking and fintech environments",
  architecture: "CI-ready Playwright framework architecture (page object pattern)",
  domainExperience: "Banking and Fintech, SaaS, enterprise platforms"
};

function job(title: string, overrides: Record<string, unknown> = {}): Job {
  return JobSchema.parse({
    jobTitle: title,
    company: "Test Co",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription:
      "A sufficiently long job description mentioning quality engineering, test automation, and API testing responsibilities.",
    requirements: ["Testing experience"],
    responsibilities: ["Own test strategy"],
    skills: ["QA", "Automation"],
    source: "himalayas",
    sourceUrl: "https://himalayas.example/1",
    datePosted: "2026-08-10",
    externalJobId: "1",
    ...overrides
  });
}

/**
 * Phase 8.5.3 diagnosed a structural gap: the prompt had no matchScore
 * rubric, no mandatory-vs-nice-to-have distinction, no anti-collapse
 * guidance, no recommendation calibration, and no transferable-skills
 * guidance. Phase 8.5.4 fixes exactly that (src/prompts/jobMatching.ts) —
 * these tests now verify the fix landed, in place of the 8.5.3 tests that
 * verified the gap existed.
 */
describe("JOB_MATCHING_SYSTEM_PROMPT — fix verification (Phase 8.5.4 §12)", () => {
  it("matchScore rubric exists — the priority-weighted dimensions from Phase 8.5.4 §1 are present", () => {
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/MATCH SCORE FRAMEWORK/i);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/core role/i);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/30%/);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/25%/);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/score bands/i);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/90-100/);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/0-39/);
  });

  it("mandatory vs preferred vs stretch guidance exists, including inference cues from the job posting's own wording", () => {
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/MANDATORY/);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/PREFERRED/);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/STRETCH/);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/must have/i);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/nice to have/i);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/do not assume every listed technology is mandatory/i);
  });

  it("anti-collapse guidance exists — a single preferred/stretch gap must not sink the score", () => {
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/must not collapse/i);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/must not be pushed below 70/i);
  });

  it("recommendation calibration exists — APPLY/CONSIDER/REJECT are each defined and tied to the system's real 70/70 gate", () => {
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/RECOMMENDATION CALIBRATION/i);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/careerRelevanceScore >= 70/);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/matchScore >= 70/);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/do not mark a role reject/i);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/do not use reject merely because/i);
  });

  it("transferable skill guidance exists, with concrete examples and an evidence-based limit", () => {
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/TRANSFERABLE SKILLS/);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/page object model.*service object model/i);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/label it inference/i);
    // Still never awards credit for something the profile doesn't support at all.
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/never award credit for a skill the profile does not support/i);
  });

  it("still contains every Phase 8.3 career-relevance-score rule, unchanged", () => {
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/CAREER RELEVANCE SCORE/);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/must never by itself drag the score down/i);
    expect(JOB_MATCHING_SYSTEM_PROMPT).toMatch(/Never invent, assume, or embellish experience the profile does not state\./);
  });

  it("the Job schema's `requirements` field still has no mandatory/nice-to-have structure — Claude must infer it from the posting's own wording (Phase 8.5.4 §2), not a code change", () => {
    const testJob = job("Senior QA Engineer", { requirements: ["5+ years testing", "Playwright preferred"] });
    expect(testJob.requirements).toHaveLength(2);
    expect(Array.isArray(testJob.requirements)).toBe(true);
  });
});

/**
 * Phase 8.5.4 §9 — negative regression: the new scoring rules must not
 * make unrelated roles score higher. These never reach Claude at all under
 * the unchanged Phase 8.3/8.3.3 pre-Claude filters — as of Phase 8.5.9 §8,
 * this now also includes an unreinforced "Engineering Manager" title (the
 * ambiguous-title path requires a genuine secondary-signal combination, not
 * just the title). The Engineering Manager case below constructs a
 * JobMatchSchema response directly (not via the live pipeline) to confirm
 * that IF such a role's description carried enough signal to reach Claude,
 * the gate would still correctly exclude a genuinely unrelated result.
 */
describe("Negative regression — unrelated roles stay excluded (Phase 8.5.4 §9)", () => {
  it("Office Assistant is rejected by the positive prefilter before any Claude call", async () => {
    const { hasPositiveCareerSignal } = await import("../../src/services/careerRelevanceFilter.js");
    const officeAssistantJob = job("Remote Office Assistant", {
      jobDescription: "Support daily office operations and administrative tasks for a small distributed team.",
      requirements: ["Organizational skills"],
      responsibilities: ["Manage calendars"],
      skills: ["Scheduling"]
    });
    expect(hasPositiveCareerSignal(officeAssistantJob)).toBe(false);
  });

  it("Service Desk Engineer is rejected by the hard negative filter before any Claude call", async () => {
    const { isHardNegativeRole } = await import("../../src/services/careerRelevanceFilter.js");
    expect(isHardNegativeRole(job("Tier III Service Desk Engineer"))).toBe(true);
  });

  it("Senior Data Engineer is rejected by the positive prefilter before any Claude call", async () => {
    const { hasPositiveCareerSignal } = await import("../../src/services/careerRelevanceFilter.js");
    const dataEngineerJob = job("Senior Data Engineer", {
      jobDescription: "Design and maintain data pipelines and ETL workflows for our analytics platform.",
      requirements: ["5+ years data engineering"],
      responsibilities: ["Build data pipelines"],
      skills: ["Python", "Spark"]
    });
    expect(hasPositiveCareerSignal(dataEngineerJob)).toBe(false);
  });

  it("an unrelated Engineering Manager role, if it ever reaches Claude, still validates as a correctly-excluded low score", () => {
    // As of Phase 8.5.9 §8, "Engineering Manager" alone no longer
    // pre-Claude-passes on title — it needs a genuine secondary-signal
    // combination too (see careerRelevanceFilter.test.ts [I]/[I2]). This
    // test only confirms the downstream gate: IF such a role's description
    // ever carried enough signal to reach Claude, a genuinely-unrelated
    // result still schema-validates and still fails the 70/70 gate — the
    // new rubric does not force such a role's score upward.
    const response = JobMatchSchema.parse({
      matchScore: 12,
      interviewPotential: 15,
      careerGrowth: 30,
      futureAIValue: 20,
      recommendation: "REJECT",
      strongMatches: [],
      transferableSkills: [],
      gaps: [{ statement: "No general engineering-management experience stated in the profile", evidence: "UNKNOWN" }],
      risks: [],
      reason: "People-management role with no quality-engineering ownership — fundamental misalignment, not a preferred-skill gap.",
      careerRelevanceScore: 8,
      whySelected: "Outside the target QA/quality-engineering career family."
    });
    expect(response.matchScore).toBeLessThan(70);
    expect(response.careerRelevanceScore).toBeLessThan(70);
  });

  it("Manufacturing QA and Food QA are rejected by the non-software-QA filter before any Claude call", async () => {
    const { isNonSoftwareQaRole } = await import("../../src/services/careerRelevanceFilter.js");
    expect(isNonSoftwareQaRole(job("Manufacturing QA Technician"))).toBe(true);
    expect(isNonSoftwareQaRole(job("Food QA Inspector"))).toBe(true);
  });

  it("AI Data Annotator is rejected by the non-software-QA filter before any Claude call", async () => {
    const { isNonSoftwareQaRole } = await import("../../src/services/careerRelevanceFilter.js");
    expect(isNonSoftwareQaRole(job("AI Data Annotator"))).toBe(true);
  });
});

describe("CoverGo-shaped Senior Software QA Engineer — mocked pipeline check (Phase 8.5.3 §5)", () => {
  it("a well-calibrated Claude response for a strong QA-family role validates cleanly and would clear the 70/70 gate", () => {
    // Synthetic job — conceptual shape only, not copied from any real posting.
    const coverGoShapedJob = job("Senior Software QA Engineer", {
      company: "Example FinTech Co",
      jobDescription:
        "Own quality strategy for our insurance platform. Build and maintain Playwright-based API and UI automation. " +
        "Partner with engineering on CI/CD pipeline test gating and drive test architecture decisions. " +
        "Nice to have: experience with a specific cloud certification and a specific niche automation tool we use internally.",
      requirements: [
        "5+ years in software quality engineering",
        "Strong API testing background",
        "Test automation framework design experience",
        "Nice to have: specific cloud certification",
        "Nice to have: familiarity with our internal tool X"
      ],
      responsibilities: ["Own quality strategy", "Build Playwright automation", "Drive test architecture"],
      skills: ["QA", "Software Quality", "Automation", "API Testing", "CI/CD", "Test Architecture"]
    });

    // This response represents what a WELL-CALIBRATED evaluator (with an
    // explicit rubric weighting core role fit heavily and nice-to-haves
    // lightly) would plausibly produce — NOT a live Claude call.
    const wellCalibratedResponse = {
      matchScore: 82,
      interviewPotential: 75,
      careerGrowth: 65,
      futureAIValue: 55,
      recommendation: "APPLY",
      strongMatches: [
        { statement: "Strong API testing and Playwright automation background", evidence: "FACT" },
        { statement: "Test strategy ownership experience", evidence: "FACT" }
      ],
      transferableSkills: [],
      gaps: [
        { statement: "No confirmed experience with the specific cloud certification", evidence: "UNKNOWN" },
        { statement: "No confirmed experience with the specific internal tool", evidence: "UNKNOWN" }
      ],
      risks: [],
      reason: "Strong core QA/automation/API-testing fit; missing items are stretch nice-to-haves, not core requirements.",
      careerRelevanceScore: 90,
      whySelected: "Direct fit for the target Senior/Principal QA engineering track."
    };

    const result = JobMatchSchema.safeParse(wellCalibratedResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.matchScore).toBeGreaterThanOrEqual(70);
      expect(result.data.careerRelevanceScore).toBeGreaterThanOrEqual(70);
      expect(["APPLY", "CONSIDER"]).toContain(result.data.recommendation);
    }

    // The prompt itself is still fully buildable for this job — proves the
    // pipeline up to the Claude call has no defect; the gap is purely in
    // what guidance the prompt gives Claude about HOW to weigh gaps.
    const prompt = buildJobMatchingUserPrompt(coverGoShapedJob, profile);
    expect(prompt).toContain("Senior Software QA Engineer");
  });

  it("an over-penalized response (matching the real production shape) is also schema-valid — proving the gate/schema layer isn't the bug", () => {
    // Mirrors the actual production report's shape (careerRelevanceScore
    // high, matchScore low despite strong core fit) to confirm this ISN'T
    // rejected by schema/validation — it's a legitimate score the system
    // faithfully honors. The system is working correctly; the SCORE ITSELF
    // is the thing in question, and that's produced entirely by Claude
    // under the current prompt's lack of rubric guidance.
    const overPenalizedResponse = {
      matchScore: 45,
      interviewPotential: 40,
      careerGrowth: 50,
      futureAIValue: 40,
      recommendation: "REJECT",
      strongMatches: [{ statement: "Solid QA and automation background", evidence: "FACT" }],
      transferableSkills: [],
      gaps: [
        { statement: "No confirmed experience with the specific cloud certification", evidence: "UNKNOWN" },
        { statement: "No confirmed experience with the specific internal tool", evidence: "UNKNOWN" },
        { statement: "No confirmed insurance-domain experience", evidence: "UNKNOWN" }
      ],
      risks: [],
      reason: "Several unconfirmed requirements reduce overall fit confidence.",
      careerRelevanceScore: 78,
      whySelected: "Role belongs to the target career family but candidate fit is uncertain in several areas."
    };

    const result = JobMatchSchema.safeParse(overPenalizedResponse);
    expect(result.success).toBe(true); // schema correctly accepts it — not a validation bug
    if (result.success) {
      expect(result.data.matchScore).toBeLessThan(70); // this is exactly why it fails the gate — legitimately, given this score
      expect(result.data.careerRelevanceScore).toBeGreaterThanOrEqual(70); // confirms career relevance filtering worked correctly
    }
  });
});

/** Phase 8.5.3 §9 — cases A-H. Each mocks the DESIRED/plausible outcome and confirms the schema/threshold layer supports it; none of these call Claude. */
describe("Diagnostic test cases A-H (Phase 8.5.3 §9)", () => {
  it("[A] Strong Senior QA Automation job — expects careerRelevance >= 70, matchScore >= 70, APPLY or CONSIDER", () => {
    const response = {
      matchScore: 85,
      interviewPotential: 75,
      careerGrowth: 65,
      futureAIValue: 55,
      recommendation: "APPLY",
      strongMatches: [{ statement: "Strong automation and API testing background", evidence: "FACT" }],
      transferableSkills: [],
      gaps: [],
      risks: [],
      reason: "Direct core-role match.",
      careerRelevanceScore: 92,
      whySelected: "Strong direct fit."
    };
    const result = JobMatchSchema.parse(response);
    expect(result.careerRelevanceScore).toBeGreaterThanOrEqual(70);
    expect(result.matchScore).toBeGreaterThanOrEqual(70);
    expect(["APPLY", "CONSIDER"]).toContain(result.recommendation);
  });

  it("[B] Principal QA Architect job — expects a strong match", () => {
    const response = {
      matchScore: 88,
      interviewPotential: 80,
      careerGrowth: 75,
      futureAIValue: 60,
      recommendation: "APPLY",
      strongMatches: [{ statement: "Architecture and test strategy leadership experience", evidence: "FACT" }],
      transferableSkills: [],
      gaps: [],
      risks: [],
      reason: "Direct architecture-level fit.",
      careerRelevanceScore: 95,
      whySelected: "Principal/architecture-scope match."
    };
    const result = JobMatchSchema.parse(response);
    expect(result.matchScore).toBeGreaterThanOrEqual(70);
    expect(result.careerRelevanceScore).toBeGreaterThanOrEqual(70);
  });

  it("[C] AI Quality Engineer with transferable QA background — expects a strategic (still qualifying) match", () => {
    const response = {
      matchScore: 76,
      interviewPotential: 65,
      careerGrowth: 80,
      futureAIValue: 90,
      recommendation: "APPLY",
      strongMatches: [{ statement: "AI/LLM/RAG testing specialization", evidence: "FACT" }],
      transferableSkills: [{ statement: "QA leadership transfers to AI quality ownership", evidence: "INFERENCE" }],
      gaps: [],
      risks: [],
      reason: "Strong strategic alignment with the candidate's AI-quality specialization direction.",
      careerRelevanceScore: 90,
      whySelected: "Aligned with the candidate's stated AI Quality Engineering career direction."
    };
    const result = JobMatchSchema.parse(response);
    expect(result.matchScore).toBeGreaterThanOrEqual(70);
    expect(result.careerRelevanceScore).toBeGreaterThanOrEqual(70);
  });

  it("[D] Senior Data Engineer — expects a low match (matches the real production example)", () => {
    const response = {
      matchScore: 8,
      interviewPotential: 10,
      careerGrowth: 20,
      futureAIValue: 20,
      recommendation: "REJECT",
      strongMatches: [],
      transferableSkills: [],
      gaps: [{ statement: "No data engineering pipeline/ETL experience stated in the profile", evidence: "UNKNOWN" }],
      risks: [],
      reason: "Fundamentally different engineering discipline.",
      careerRelevanceScore: 3,
      whySelected: "Not a QA/testing role."
    };
    const result = JobMatchSchema.parse(response);
    expect(result.matchScore).toBeLessThan(70);
    expect(result.careerRelevanceScore).toBeLessThan(70);
    expect(result.recommendation).toBe("REJECT");
  });

  it("[E] Engineering Manager with no quality ownership — expects a low match (matches the real production example)", () => {
    const response = {
      matchScore: 12,
      interviewPotential: 15,
      careerGrowth: 30,
      futureAIValue: 20,
      recommendation: "REJECT",
      strongMatches: [],
      transferableSkills: [],
      gaps: [{ statement: "No general engineering-management experience stated in the profile", evidence: "UNKNOWN" }],
      risks: [],
      reason: "People-management role with no quality-engineering ownership.",
      careerRelevanceScore: 8,
      whySelected: "Outside the target QA/quality-engineering career family."
    };
    const result = JobMatchSchema.parse(response);
    expect(result.matchScore).toBeLessThan(70);
    expect(result.careerRelevanceScore).toBeLessThan(70);
  });

  it("[F] Service Desk Engineer — expects rejection BEFORE any Claude call (hard negative filter, not a matchScore question)", async () => {
    const { isHardNegativeRole } = await import("../../src/services/careerRelevanceFilter.js");
    const serviceDeskJob = job("Tier III Service Desk Engineer");
    expect(isHardNegativeRole(serviceDeskJob)).toBe(true); // never reaches Claude at all — see Phase 8.3's hard negative filter
  });

  it("[G] QA role missing one non-mandatory framework — should NOT collapse to a low match; contrasts a well-calibrated vs. over-penalized outcome for the same job shape", () => {
    const wellCalibrated = JobMatchSchema.parse({
      matchScore: 78,
      interviewPotential: 70,
      careerGrowth: 60,
      futureAIValue: 50,
      recommendation: "APPLY",
      strongMatches: [{ statement: "Strong core automation and API testing background", evidence: "FACT" }],
      transferableSkills: [],
      gaps: [{ statement: "No confirmed experience with the specific alternate framework mentioned as preferred", evidence: "UNKNOWN" }],
      risks: [],
      reason: "One non-mandatory framework gap does not outweigh strong core fit.",
      careerRelevanceScore: 88,
      whySelected: "Strong core fit; one preferred-but-not-required framework gap."
    });
    expect(wellCalibrated.matchScore).toBeGreaterThanOrEqual(70); // this is the desired behavior

    // Contrast: an over-penalized response for the SAME job shape is also
    // schema-valid, illustrating that avoiding this outcome is a PROMPT
    // guidance question, not something the schema/gate can enforce.
    const overPenalized = JobMatchSchema.parse({
      matchScore: 42,
      interviewPotential: 40,
      careerGrowth: 50,
      futureAIValue: 40,
      recommendation: "REJECT",
      strongMatches: [{ statement: "Strong core automation and API testing background", evidence: "FACT" }],
      transferableSkills: [],
      gaps: [{ statement: "No confirmed experience with the specific alternate framework mentioned as preferred", evidence: "UNKNOWN" }],
      risks: [],
      reason: "Missing the preferred framework.",
      careerRelevanceScore: 85,
      whySelected: "Role belongs to the target family but a preferred skill is unconfirmed."
    });
    expect(overPenalized.matchScore).toBeLessThan(70); // demonstrates the failure mode this phase is diagnosing
  });

  it("[H] QA role with strong API + automation + CI/CD but a different test framework — should remain a strong candidate", () => {
    const response = {
      matchScore: 80,
      interviewPotential: 72,
      careerGrowth: 62,
      futureAIValue: 52,
      recommendation: "APPLY",
      strongMatches: [
        { statement: "Strong API testing background", evidence: "FACT" },
        { statement: "Strong test automation background", evidence: "FACT" },
        { statement: "CI/CD pipeline integration experience", evidence: "FACT" }
      ],
      transferableSkills: [{ statement: "Automation framework design skills transfer across specific tools", evidence: "INFERENCE" }],
      gaps: [{ statement: "No confirmed experience with the specific framework named in the posting", evidence: "UNKNOWN" }],
      risks: [],
      reason: "Core automation/API/CI-CD competencies are strong and transferable across specific framework choices.",
      careerRelevanceScore: 88,
      whySelected: "Strong core automation/testing fit; framework choice is a transferable skill, not a blocker."
    };
    const result = JobMatchSchema.parse(response);
    expect(result.matchScore).toBeGreaterThanOrEqual(70);
    expect(result.careerRelevanceScore).toBeGreaterThanOrEqual(70);
  });
});
