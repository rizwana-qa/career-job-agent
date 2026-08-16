import { describe, expect, it } from "vitest";
import {
  calculateCareerScore,
  classifyScore,
  computeFreshnessScore,
  rankJobs,
  selectTopJobs,
  type RankableEntry
} from "../../src/ranking/jobRanking.js";
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

/** Freshness bucket thresholds (Phase 8.5 §10). */
describe("computeFreshnessScore", () => {
  function hoursAgo(hours: number): string {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  it("scores 0-24 hours old as the highest bucket", () => {
    expect(computeFreshnessScore(baseJob({ datePosted: hoursAgo(1) }))).toBe(100);
  });

  it("scores 24-72 hours old as the high bucket", () => {
    expect(computeFreshnessScore(baseJob({ datePosted: hoursAgo(48) }))).toBe(85);
  });

  it("scores 3-7 days old as the medium bucket", () => {
    expect(computeFreshnessScore(baseJob({ datePosted: hoursAgo(24 * 5) }))).toBe(65);
  });

  it("scores 7-14 days old as the low bucket", () => {
    expect(computeFreshnessScore(baseJob({ datePosted: hoursAgo(24 * 10) }))).toBe(40);
  });

  it("scores older than 14 days as low but never zero", () => {
    const score = computeFreshnessScore(baseJob({ datePosted: hoursAgo(24 * 30) }));
    expect(score).toBe(25);
    expect(score).toBeGreaterThan(0);
  });

  it("returns null for an unparseable date rather than guessing", () => {
    // datePosted is schema-validated elsewhere, but computeFreshnessScore()
    // itself must stay defensive against a genuinely malformed value.
    const job = baseJob();
    expect(computeFreshnessScore({ ...job, datePosted: "not-a-date" })).toBeNull();
  });
});

/** Freshness as an opt-in ranking factor (Phase 8.5 §10) — never applied unless RankingOptions.applyFreshnessBonus is explicitly true. */
describe("calculateCareerScore — opt-in freshness bonus", () => {
  function hoursAgo(hours: number): string {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  it("does not factor in freshness at all when applyFreshnessBonus is not set — existing callers (/career/run, /jobs/analyze) are unaffected", () => {
    const job = baseJob({ datePosted: hoursAgo(1), salary: undefined, currency: undefined });
    const match = matchWithScores(90);

    const breakdown = calculateCareerScore(job, match);
    expect(breakdown.freshnessDataAvailable).toBe(false);
    expect(breakdown.freshness).toBeNull();
    expect(breakdown.weightsUsed.freshness).toBeUndefined();

    const [ranked] = rankJobs([{ job, match }]);
    expect(ranked.careerScore).toBe(90); // identical to the no-freshness-option test above
  });

  it("factors in freshness as a minor weight when applyFreshnessBonus is true", () => {
    const job = baseJob({ datePosted: hoursAgo(1), salary: undefined, currency: undefined });
    const match = matchWithScores(90);

    const breakdown = calculateCareerScore(job, match, { applyFreshnessBonus: true });
    expect(breakdown.freshnessDataAvailable).toBe(true);
    expect(breakdown.freshness).toBe(100);
    expect(breakdown.weightsUsed.freshness).toBeGreaterThan(0);

    const [ranked] = rankJobs([{ job, match }], { applyFreshnessBonus: true });
    // (90*0.35 + 90*0.30 + 90*0.15 + 90*0.10 + 100*0.05) / 0.95 = 86/0.95 ≈ 90.5 -> rounds to 91.
    // The point of this assertion is proving no NaN/crash when freshness participates, with the expected small upward nudge from a maximally-fresh job.
    expect(ranked.careerScore).toBe(91);
  });

  it("a strong but older job still outranks a fresh but weak job — freshness is a tiebreaker, not a primary signal", () => {
    const strongOlderJob = baseJob({ externalJobId: "strong-older", datePosted: hoursAgo(24 * 20), salary: undefined, currency: undefined });
    const strongOlderMatch = matchWithScores(95);
    const freshWeakJob = baseJob({ externalJobId: "fresh-weak", datePosted: hoursAgo(1), salary: undefined, currency: undefined });
    const freshWeakMatch = matchWithScores(30);

    const ranked = rankJobs(
      [
        { job: strongOlderJob, match: strongOlderMatch },
        { job: freshWeakJob, match: freshWeakMatch }
      ],
      { applyFreshnessBonus: true }
    );

    expect(ranked[0].job.externalJobId).toBe("strong-older");
  });
});
