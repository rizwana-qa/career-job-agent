import { describe, expect, it } from "vitest";
import { isLocationEligible } from "../../src/services/locationEligibilityFilter.js";
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

describe("isLocationEligible", () => {
  it("admits an ONSITE job in Islamabad, Pakistan", () => {
    expect(isLocationEligible(job({ remoteStatus: "ONSITE", location: "Islamabad, Pakistan", country: "Pakistan" }))).toBe(true);
  });

  it("admits a HYBRID job in Pakistan by country match", () => {
    expect(isLocationEligible(job({ remoteStatus: "HYBRID", location: "Lahore", country: "Pakistan" }))).toBe(true);
  });

  it("admits an ONSITE job in Dubai, UAE", () => {
    expect(isLocationEligible(job({ remoteStatus: "ONSITE", location: "Dubai, UAE", country: "United Arab Emirates" }))).toBe(true);
  });

  it("admits an ONSITE job in Abu Dhabi", () => {
    expect(isLocationEligible(job({ remoteStatus: "ONSITE", location: "Abu Dhabi", country: "United Arab Emirates" }))).toBe(true);
  });

  it("admits a HYBRID job in the UAE by country match even without a matching city keyword", () => {
    expect(isLocationEligible(job({ remoteStatus: "HYBRID", location: "Sharjah", country: "UAE" }))).toBe(true);
  });

  it("never rejects a REMOTE job, even when its country is outside Pakistan/UAE (worldwide remote is preserved)", () => {
    expect(isLocationEligible(job({ remoteStatus: "REMOTE", location: "Worldwide", country: "Worldwide" }))).toBe(true);
    expect(isLocationEligible(job({ remoteStatus: "REMOTE", location: "Remote - Europe", country: "Germany" }))).toBe(true);
  });

  it("rejects an ONSITE job outside Pakistan/UAE", () => {
    expect(isLocationEligible(job({ remoteStatus: "ONSITE", location: "Paris", country: "France" }))).toBe(false);
  });

  it("rejects a HYBRID job outside Pakistan/UAE", () => {
    expect(isLocationEligible(job({ remoteStatus: "HYBRID", location: "Berlin", country: "Germany" }))).toBe(false);
  });
});
