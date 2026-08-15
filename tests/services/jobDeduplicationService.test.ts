import { describe, expect, it } from "vitest";
import { deduplicateDiscoveredJobs, deduplicateAcrossSources } from "../../src/services/jobDeduplicationService.js";
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

/** Cross-source deduplication (Phase 8.4 §8) — used only by POST /career/discover-match's multi-source path. */
describe("deduplicateAcrossSources", () => {
  it("collapses the same role posted on two different sources into one opportunity, preserving the other source's URL internally", () => {
    const remotivePosting = job({
      source: "remotive",
      externalJobId: "r-1",
      company: "Vantage AI",
      jobTitle: "AI Quality Engineer",
      sourceUrl: "https://remotive.com/remote-jobs/qa/vantage-1"
    });
    const indeedPosting = job({
      source: "indeed",
      externalJobId: "i-1",
      company: "Vantage AI",
      jobTitle: "AI Quality Engineer",
      sourceUrl: "https://www.indeed.com/viewjob?jk=vantage-1"
    });

    const { deduplicated, duplicatesRemoved } = deduplicateAcrossSources([remotivePosting, indeedPosting]);

    expect(deduplicated).toHaveLength(1);
    expect(duplicatesRemoved).toBe(1);
    // First-seen (Remotive) kept as canonical sourceUrl — a simple, deterministic tie-break.
    expect(deduplicated[0].sourceUrl).toBe("https://remotive.com/remote-jobs/qa/vantage-1");
    expect(deduplicated[0].alternateSourceUrls).toEqual(["https://www.indeed.com/viewjob?jk=vantage-1"]);
  });

  it("does not merge two distinct jobs from the same source sharing a company+title", () => {
    const a = job({ source: "remotive", externalJobId: "1", company: "Acme Co", jobTitle: "QA Engineer" });
    const b = job({ source: "remotive", externalJobId: "2", company: "Acme Co", jobTitle: "QA Engineer", sourceUrl: "https://remotive.com/remote-jobs/qa/job-2" });

    const { deduplicated, duplicatesRemoved } = deduplicateAcrossSources([a, b]);

    expect(deduplicated).toHaveLength(2);
    expect(duplicatesRemoved).toBe(0);
  });

  it("still applies exact same-source dedup (source+externalJobId) before the cross-source pass", () => {
    const a = job({ source: "remotive", externalJobId: "1" });
    const b = job({ source: "remotive", externalJobId: "1", sourceUrl: "https://remotive.com/remote-jobs/qa/job-1-mirror" });

    const { deduplicated } = deduplicateAcrossSources([a, b]);

    expect(deduplicated).toHaveLength(1);
  });

  it("merges a duplicate found across three sources into one opportunity with two alternate URLs", () => {
    const remotivePosting = job({ source: "remotive", externalJobId: "r-1", company: "Falcon Group", jobTitle: "SDET" });
    const indeedPosting = job({
      source: "indeed",
      externalJobId: "i-1",
      company: "Falcon Group",
      jobTitle: "SDET",
      sourceUrl: "https://www.indeed.com/viewjob?jk=falcon-1"
    });
    const gulfTalentPosting = job({
      source: "gulftalent",
      externalJobId: "g-1",
      company: "Falcon Group",
      jobTitle: "SDET",
      sourceUrl: "https://www.gulftalent.com/jobs/falcon-1"
    });

    const { deduplicated, duplicatesRemoved } = deduplicateAcrossSources([remotivePosting, indeedPosting, gulfTalentPosting]);

    expect(deduplicated).toHaveLength(1);
    expect(duplicatesRemoved).toBe(2);
    expect(deduplicated[0].alternateSourceUrls).toHaveLength(2);
  });

  it("does not merge unrelated jobs from different sources", () => {
    const a = job({ source: "remotive", externalJobId: "1", company: "Acme Co", jobTitle: "QA Engineer" });
    const b = job({ source: "indeed", externalJobId: "2", company: "Other Co", jobTitle: "SDET", sourceUrl: "https://www.indeed.com/viewjob?jk=2" });

    const { deduplicated, duplicatesRemoved } = deduplicateAcrossSources([a, b]);

    expect(deduplicated).toHaveLength(2);
    expect(duplicatesRemoved).toBe(0);
  });
});
