import { describe, expect, it } from "vitest";
import { isLocationEligible, classifyRemoteEligibility } from "../../src/services/locationEligibilityFilter.js";
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

/** 3-tier remote classification (Phase 8.5 §6). */
describe("classifyRemoteEligibility", () => {
  it("classifies Worldwide/Global/Anywhere as REMOTE_PK_ELIGIBLE", () => {
    expect(classifyRemoteEligibility(job({ location: "Worldwide", country: "Worldwide" }))).toBe("REMOTE_PK_ELIGIBLE");
    expect(classifyRemoteEligibility(job({ location: "Remote - Global", country: "Global" }))).toBe("REMOTE_PK_ELIGIBLE");
  });

  it("classifies Pakistan/Asia/APAC/Middle East as REMOTE_PK_ELIGIBLE", () => {
    expect(classifyRemoteEligibility(job({ location: "Remote - Pakistan", country: "Pakistan" }))).toBe("REMOTE_PK_ELIGIBLE");
    expect(classifyRemoteEligibility(job({ location: "Remote - Asia", country: "Asia" }))).toBe("REMOTE_PK_ELIGIBLE");
    expect(classifyRemoteEligibility(job({ location: "APAC Remote", country: "APAC" }))).toBe("REMOTE_PK_ELIGIBLE");
    expect(classifyRemoteEligibility(job({ location: "Middle East Remote", country: "Middle East" }))).toBe("REMOTE_PK_ELIGIBLE");
  });

  it("classifies US-only/Canada-only/EU-only/US-work-authorization listings as REMOTE_EXCLUDED", () => {
    expect(classifyRemoteEligibility(job({ location: "Remote (US only)", country: "United States" }))).toBe("REMOTE_EXCLUDED");
    expect(classifyRemoteEligibility(job({ location: "Remote - Canada only", country: "Canada" }))).toBe("REMOTE_EXCLUDED");
    expect(classifyRemoteEligibility(job({ location: "Remote (EU only)", country: "Germany" }))).toBe("REMOTE_EXCLUDED");
    expect(classifyRemoteEligibility(job({ location: "Remote — US work authorization required", country: "United States" }))).toBe(
      "REMOTE_EXCLUDED"
    );
  });

  it("classifies a bare EMEA listing as REMOTE_UNCLEAR — not automatically Pakistan-eligible", () => {
    expect(classifyRemoteEligibility(job({ location: "EMEA Remote", country: "EMEA" }))).toBe("REMOTE_UNCLEAR");
  });

  it("classifies an unlabeled country like plain 'Germany' as REMOTE_UNCLEAR, not excluded", () => {
    expect(classifyRemoteEligibility(job({ location: "Remote - Europe", country: "Germany" }))).toBe("REMOTE_UNCLEAR");
  });

  it("isLocationEligible only rejects REMOTE_EXCLUDED — REMOTE_UNCLEAR still passes", () => {
    expect(isLocationEligible(job({ location: "Remote (US only)", country: "United States" }))).toBe(false);
    expect(isLocationEligible(job({ location: "EMEA Remote", country: "EMEA" }))).toBe(true);
    expect(isLocationEligible(job({ location: "Remote - Europe", country: "Germany" }))).toBe(true);
  });

  /** Phase 8.5.12 §7 cases I/J — location eligibility is driven by actual normalized job metadata, never by search query text. */
  it("[I] a Pakistan-eligible REMOTE job (real location/country metadata) survives isLocationEligible", () => {
    expect(isLocationEligible(job({ remoteStatus: "REMOTE", location: "Remote - Pakistan", country: "Pakistan" }))).toBe(true);
  });

  it("[J] a US-only REMOTE job is still rejected by isLocationEligible", () => {
    expect(isLocationEligible(job({ remoteStatus: "REMOTE", location: "Remote (US only)", country: "United States" }))).toBe(false);
  });
});
