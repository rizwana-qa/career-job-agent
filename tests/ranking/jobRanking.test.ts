import { describe, expect, it } from "vitest";
import { calculateCareerScore, classifyScore, rankJobs, selectTopJobs, type RankableEntry } from "../../src/ranking/jobRanking.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";
import type { JobMatch } from "../../src/schemas/jobMatch.js";
import { loadJobFixture } from "../helpers/fixtures.js";

function baseJob(overrides: Partial<Job> = {}): Job {
  const parsed = JobSchema.parse(loadJobFixture("01-principal-qa-engineer.json"));
  return { ...parsed, ...overrides };
}

function matchWithScores(value: number): JobMatch {
  return {
    matchScore: value,
    interviewPotential: value,
    careerGrowth: value,
    futureAIValue: value,
    recommendation: "APPLY",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture"
  };
}

describe("classifyScore boundaries", () => {
  it.each([
    [100, "EXCEPTIONAL"],
    [90, "EXCEPTIONAL"],
    [89, "HIGH_PRIORITY"],
    [80, "HIGH_PRIORITY"],
    [79, "CONSIDER"],
    [70, "CONSIDER"],
    [69, "LOW_PRIORITY"],
    [60, "LOW_PRIORITY"],
    [59, "REJECT"],
    [0, "REJECT"]
  ] as const)("classifies %i as %s", (score, expected) => {
    expect(classifyScore(score)).toBe(expected);
  });
});

describe("calculateCareerScore / weighted total via rankJobs", () => {
  it("produces the same weighted score as the input when all four core scores are equal and salary is unknown", () => {
    const job = baseJob({ salary: undefined, currency: undefined });
    const match = matchWithScores(90);

    const [ranked] = rankJobs([{ job, match }]);

    expect(ranked.careerScore).toBe(90);
    expect(ranked.classification).toBe("EXCEPTIONAL");
    expect(ranked.scoreBreakdown.salaryDataAvailable).toBe(false);
    expect(ranked.scoreBreakdown.salaryPotential).toBeNull();
  });

  it("applies distinct weights correctly when a reference salary is available", () => {
    const job = baseJob({ salary: 200000, currency: "USD" });
    const match: JobMatch = {
      matchScore: 80,
      interviewPotential: 70,
      careerGrowth: 60,
      futureAIValue: 50,
      recommendation: "CONSIDER",
      strongMatches: [],
      transferableSkills: [],
      gaps: [],
      risks: [],
      reason: "test fixture"
    };

    const [ranked] = rankJobs([{ job, match }], { referenceSalary: 200000 });

    // 80*.35 + 70*.30 + 60*.15 + 50*.10 + 100*.10 = 28+21+9+5+10 = 73
    expect(ranked.careerScore).toBe(73);
    expect(ranked.classification).toBe("CONSIDER");
    expect(ranked.scoreBreakdown.salaryDataAvailable).toBe(true);
  });

  it("does not fabricate a salary comparison when the job has no disclosed salary, even with a reference configured", () => {
    const job = baseJob({ salary: undefined, currency: undefined });
    const match = matchWithScores(100);
    match.interviewPotential = 0;
    match.careerGrowth = 0;
    match.futureAIValue = 0;

    const [ranked] = rankJobs([{ job, match }], { referenceSalary: 200000 });

    expect(ranked.scoreBreakdown.salaryDataAvailable).toBe(false);
    // matchScore weight (.35) renormalized over the remaining .90 of weight: 100 * (.35/.90) ≈ 38.9 -> 39
    expect(ranked.careerScore).toBe(39);
  });

  it("does not score salary potential when a job has a salary but no reference salary is configured", () => {
    const job = baseJob({ salary: 200000, currency: "USD" });
    const match = matchWithScores(50);

    const breakdown = calculateCareerScore(job, match);
    expect(breakdown.salaryDataAvailable).toBe(false);
    expect(breakdown.salaryPotential).toBeNull();
  });
});

describe("rankJobs / selectTopJobs", () => {
  function entry(id: string, score: number): RankableEntry {
    return { job: baseJob({ externalJobId: id }), match: matchWithScores(score) };
  }

  it("sorts jobs by careerScore descending", () => {
    const entries = [entry("low", 40), entry("high", 95), entry("mid", 70)];
    const ranked = rankJobs(entries);

    expect(ranked.map((r) => r.job.externalJobId)).toEqual(["high", "mid", "low"]);
  });

  it("selects only the top N jobs", () => {
    const entries = Array.from({ length: 8 }, (_, i) => entry(`job-${i}`, i * 10));
    const ranked = rankJobs(entries);
    const top = selectTopJobs(ranked, 5);

    expect(top).toHaveLength(5);
    expect(top[0].job.externalJobId).toBe("job-7");
  });

  it("returns an empty array for an empty input", () => {
    expect(rankJobs([])).toEqual([]);
    expect(selectTopJobs([], 5)).toEqual([]);
  });

  it("defaults to a top-5 selection when no count is given", () => {
    const entries = Array.from({ length: 7 }, (_, i) => entry(`job-${i}`, i * 5));
    const ranked = rankJobs(entries);
    expect(selectTopJobs(ranked)).toHaveLength(5);
  });
});
