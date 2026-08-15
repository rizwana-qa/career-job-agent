import { describe, expect, it } from "vitest";
import { deduplicateDiscoveredJobs } from "../../src/services/jobDeduplicationService.js";
import { JobSchema, type Job } from "../../src/schemas/job.js";

function job(overrides: Record<string, unknown> = {}): Job {
  return JobSchema.parse({
    jobTitle: "Quality Engineer",
    company: "Acme Co",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: "A sufficiently long job description for schema validation purposes.",
    requirements: ["Testing experience"],
    responsibilities: ["Test things"],
    skills: ["Testing"],
    source: "remotive",
    sourceUrl: "https://remotive.com/remote-jobs/qa/job-1",
    datePosted: "2026-08-10",
    externalJobId: "1",
    ...overrides
  });
}

describe("deduplicateDiscoveredJobs", () => {
  it("removes an exact duplicate sharing the same source + externalJobId", () => {
    const a = job({ externalJobId: "1" });
    const b = job({ externalJobId: "1", sourceUrl: "https://remotive.com/remote-jobs/qa/job-1-mirror" });
    expect(deduplicateDiscoveredJobs([a, b])).toHaveLength(1);
  });

  it("namespaces externalJobId by source — the same numeric id from two different sources is not a duplicate", () => {
    const a = job({ externalJobId: "1", source: "remotive" });
    const b = job({ externalJobId: "1", source: "another-source" });
    expect(deduplicateDiscoveredJobs([a, b])).toHaveLength(2);
  });

  it("falls back to company+title+location+source when externalJobId is absent", () => {
    const { externalJobId, ...withoutId } = job();
    void externalJobId;
    const a = withoutId as Job;
    const b = { ...withoutId, sourceUrl: "https://remotive.com/remote-jobs/qa/job-1-different" } as Job;
    expect(deduplicateDiscoveredJobs([a, b])).toHaveLength(1);
  });

  it("does not merge two genuinely different jobs", () => {
    const a = job({ externalJobId: "1", jobTitle: "Quality Engineer" });
    const b = job({ externalJobId: "2", jobTitle: "AI Quality Engineer" });
    expect(deduplicateDiscoveredJobs([a, b])).toHaveLength(2);
  });

  it("returns an empty array for empty input", () => {
    expect(deduplicateDiscoveredJobs([])).toEqual([]);
  });

  it("does not use Claude or any async operation — purely synchronous and deterministic", () => {
    const jobs = [job({ externalJobId: "1" }), job({ externalJobId: "1" }), job({ externalJobId: "2" })];
    const result = deduplicateDiscoveredJobs(jobs);
    expect(result).toHaveLength(2);
  });
});
