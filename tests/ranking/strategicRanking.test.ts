import { describe, expect, it } from "vitest";
import {
  evaluateSeniorityScope,
  scoreLocationEligibilityForRanking,
  calculateStrategicRankingScore
} from "../../src/ranking/strategicRanking.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";
import type { JobMatch } from "../../src/schemas/jobMatch.js";
import type { RankedJob } from "../../src/ranking/jobRanking.js";

function job(title: string, overrides: Record<string, unknown> = {}): Job {
  return JobSchema.parse({
    jobTitle: title,
    company: "Test Co",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: "A sufficiently long job description for schema validation purposes.",
    requirements: ["Testing experience"],
    responsibilities: ["Test things"],
    skills: ["Testing"],
    source: "himalayas",
    sourceUrl: "https://himalayas.example/1",
    datePosted: "2026-08-10",
    externalJobId: "1",
    ...overrides
  });
}

function match(overrides: Partial<JobMatch> = {}): JobMatch {
  return {
    matchScore: 75,
    interviewPotential: 65,
    careerGrowth: 60,
    futureAIValue: 50,
    recommendation: "APPLY",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason",
    careerRelevanceScore: 80,
    whySelected: "test",
    ...overrides
  };
}

function ranked(jobArg: Job, matchArg: JobMatch): RankedJob {
  return {
    job: jobArg,
    match: matchArg,
    careerScore: 0,
    classification: "CONSIDER",
    scoreBreakdown: {
      matchScore: matchArg.matchScore,
      interviewPotential: matchArg.interviewPotential,
      careerGrowth: matchArg.careerGrowth,
      futureAIValue: matchArg.futureAIValue,
      salaryPotential: null,
      salaryDataAvailable: false,
      freshness: null,
      freshnessDataAvailable: false,
      weightsUsed: {}
    }
  };
}

describe("evaluateSeniorityScope — title tier detection (Phase 8.5.5 §3)", () => {
  it("classifies Principal and Architect titles as PRINCIPAL_ARCHITECT, the highest tier", () => {
    expect(evaluateSeniorityScope(job("Principal QA Engineer")).titleTier).toBe("PRINCIPAL_ARCHITECT");
    expect(evaluateSeniorityScope(job("QA Architect")).titleTier).toBe("PRINCIPAL_ARCHITECT");
    expect(evaluateSeniorityScope(job("Principal Software Quality Engineer")).titleTier).toBe("PRINCIPAL_ARCHITECT");
  });

  it("classifies Staff and Lead titles correctly", () => {
    expect(evaluateSeniorityScope(job("Staff QA Engineer")).titleTier).toBe("STAFF");
    expect(evaluateSeniorityScope(job("Lead QA Engineer")).titleTier).toBe("LEAD");
  });

  it("classifies Senior titles as SENIOR, and Mid/Junior titles below that", () => {
    expect(evaluateSeniorityScope(job("Senior QA Engineer")).titleTier).toBe("SENIOR");
    expect(evaluateSeniorityScope(job("QA Engineer II")).titleTier).toBe("MID");
    expect(evaluateSeniorityScope(job("Junior QA Engineer")).titleTier).toBe("JUNIOR");
  });

  it("falls back to UNSPECIFIED when the title has no seniority word at all", () => {
    expect(evaluateSeniorityScope(job("AI Quality Engineer")).titleTier).toBe("UNSPECIFIED");
  });

  it("PRINCIPAL_ARCHITECT scores higher than STAFF, which scores higher than LEAD, with no scope signals present", () => {
    const principal = evaluateSeniorityScope(job("Principal QA Engineer"));
    const staff = evaluateSeniorityScope(job("Staff QA Engineer"));
    const lead = evaluateSeniorityScope(job("Lead QA Engineer"));
    expect(principal.score).toBeGreaterThan(staff.score);
    expect(staff.score).toBeGreaterThan(lead.score);
  });
});

describe("evaluateSeniorityScope — scope signals refine, but never solely determine, the score (Phase 8.5.5 §3-4)", () => {
  it("a Senior title with strong architecture/ownership signals scores as HIGH_SCOPE, above a bare Senior title", () => {
    const highScope = evaluateSeniorityScope(
      job("Senior Software Quality Engineer", {
        jobDescription:
          "Own quality strategy and test architecture. Drive automation architecture and framework ownership. Mentor junior engineers.",
        responsibilities: ["Own quality strategy", "Design automation frameworks"]
      })
    );
    const bare = evaluateSeniorityScope(job("Senior QA Engineer"));

    expect(highScope.scopeLabel).toBe("HIGH_SCOPE");
    expect(highScope.score).toBeGreaterThan(bare.score);
  });

  it("a Senior title dominated by manual-execution language scores as EXECUTION_FOCUSED, below a bare Senior title — a meaningful penalty, not a rejection", () => {
    const executionFocused = evaluateSeniorityScope(
      job("Senior QA Engineer", {
        jobDescription: "Execute defined tasks and manual testing under guidance, following predefined test cases.",
        responsibilities: ["Perform manual testing", "Basic bug reporting"]
      })
    );
    const bare = evaluateSeniorityScope(job("Senior QA Engineer"));

    expect(executionFocused.scopeLabel).toBe("EXECUTION_FOCUSED");
    expect(executionFocused.score).toBeLessThan(bare.score);
    expect(executionFocused.score).toBeGreaterThan(0); // never a rejection — manual testing is valid experience
  });

  it("manual testing mentioned alongside strong scope signals does not by itself collapse the score (manual testing is valid experience)", () => {
    const mixed = evaluateSeniorityScope(
      job("Senior QA Engineer", {
        jobDescription: "Own quality strategy and test architecture, while also performing manual testing when needed.",
        responsibilities: ["Own quality strategy", "Design automation frameworks"]
      })
    );
    expect(mixed.scopeLabel).toBe("HIGH_SCOPE"); // strong signals (2) outweigh the single weak mention (1)
  });

  it("never produces a score outside [0, 100] regardless of signal count", () => {
    const manySignalsText = Array(10)
      .fill("quality strategy test architecture automation architecture framework ownership technical leadership mentoring")
      .join(" ");
    const result = evaluateSeniorityScope(job("Principal QA Architect", { jobDescription: manySignalsText }));
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe("scoreLocationEligibilityForRanking (Phase 8.5.5 §2/§8)", () => {
  it("scores onsite Islamabad/Dubai/Abu Dhabi highest among eligible onsite locations", () => {
    expect(scoreLocationEligibilityForRanking(job("QA", { remoteStatus: "ONSITE", location: "Islamabad, Pakistan", country: "Pakistan" }))).toBe(100);
    expect(scoreLocationEligibilityForRanking(job("QA", { remoteStatus: "ONSITE", location: "Dubai, UAE", country: "United Arab Emirates" }))).toBe(100);
  });

  it("scores a non-preferred but still-eligible Pakistan/UAE city lower than the preferred cities", () => {
    const other = scoreLocationEligibilityForRanking(job("QA", { remoteStatus: "ONSITE", location: "Lahore", country: "Pakistan" }));
    const preferred = scoreLocationEligibilityForRanking(job("QA", { remoteStatus: "ONSITE", location: "Islamabad", country: "Pakistan" }));
    expect(other).toBeLessThan(preferred);
  });

  it("scores worldwide remote as REMOTE_PK_ELIGIBLE, higher than an unclear-scope remote listing", () => {
    const worldwide = scoreLocationEligibilityForRanking(job("QA", { remoteStatus: "REMOTE", location: "Worldwide", country: "Worldwide" }));
    const unclear = scoreLocationEligibilityForRanking(job("QA", { remoteStatus: "REMOTE", location: "EMEA Remote", country: "EMEA" }));
    expect(worldwide).toBeGreaterThan(unclear);
  });
});

describe("calculateStrategicRankingScore (Phase 8.5.5 §8) — qualitative weighting across all 8 dimensions", () => {
  it("a Principal/Architect role with strong scores outranks a Senior execution-focused role with a similar matchScore", () => {
    const principalJob = job("Principal QA Architect", {
      jobDescription: "Own test architecture and automation architecture strategy across the organization.",
      responsibilities: ["Own test architecture", "Drive automation architecture"]
    });
    const principalMatch = match({ matchScore: 78, careerRelevanceScore: 82, careerGrowth: 85, futureAIValue: 60, interviewPotential: 75 });

    const executionJob = job("Senior QA Engineer", {
      jobDescription: "Execute defined tasks and manual testing under guidance, following predefined test cases.",
      responsibilities: ["Perform manual testing"]
    });
    const executionMatch = match({ matchScore: 73, careerRelevanceScore: 78, careerGrowth: 42, futureAIValue: 30, interviewPotential: 72 });

    const principalScore = calculateStrategicRankingScore(ranked(principalJob, principalMatch));
    const executionScore = calculateStrategicRankingScore(ranked(executionJob, executionMatch));

    expect(principalScore.score).toBeGreaterThan(executionScore.score);
  });

  it("returns a rankingReason string that names the scope tier and does not expose prompt content", () => {
    const result = calculateStrategicRankingScore(
      ranked(
        job("Principal QA Architect", { jobDescription: "Own test architecture and automation architecture strategy." }),
        match({ careerGrowth: 85, futureAIValue: 70 })
      )
    );
    expect(result.reason.toLowerCase()).toContain("principal");
    expect(result.reason).not.toMatch(/system prompt|JOB_MATCHING_SYSTEM_PROMPT/i);
  });

  it("career growth materially affects the score when other factors are comparable", () => {
    const baseJob = job("Senior QA Engineer");
    const lowGrowth = calculateStrategicRankingScore(ranked(baseJob, match({ careerGrowth: 30 })));
    const highGrowth = calculateStrategicRankingScore(ranked(baseJob, match({ careerGrowth: 90 })));
    expect(highGrowth.score).toBeGreaterThan(lowGrowth.score);
  });

  it("interview potential materially affects the score when other factors are comparable", () => {
    const baseJob = job("Senior QA Engineer");
    const lowInterview = calculateStrategicRankingScore(ranked(baseJob, match({ interviewPotential: 30 })));
    const highInterview = calculateStrategicRankingScore(ranked(baseJob, match({ interviewPotential: 90 })));
    expect(highInterview.score).toBeGreaterThan(lowInterview.score);
  });

  it("future AI value is a bonus, not able to overpower a poor overall role fit", () => {
    const strongAiButOtherwiseWeak = calculateStrategicRankingScore(
      ranked(
        job("Senior QA Engineer", { jobDescription: "Execute defined tasks and manual testing under guidance." }),
        match({ matchScore: 71, careerRelevanceScore: 71, careerGrowth: 35, futureAIValue: 100, interviewPotential: 40 })
      )
    );
    const strongOverallLowAi = calculateStrategicRankingScore(
      ranked(
        job("Principal QA Architect", { jobDescription: "Own test architecture and automation architecture strategy." }),
        match({ matchScore: 85, careerRelevanceScore: 88, careerGrowth: 80, futureAIValue: 20, interviewPotential: 80 })
      )
    );
    expect(strongOverallLowAi.score).toBeGreaterThan(strongAiButOtherwiseWeak.score);
  });
});
