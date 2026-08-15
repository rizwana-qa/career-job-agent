import { describe, expect, it } from "vitest";
import { normalizeRemotiveJob } from "../../src/jobSources/remotiveNormalizer.js";
import { JobSchema } from "../../src/schemas/job.js";

function rawJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 123456,
    url: "https://remotive.com/remote-jobs/qa/senior-quality-engineer-123456",
    title: "Senior Quality Engineer",
    company_name: "Acme Remote Co",
    company_logo: "https://remotive.com/job/123456/logo",
    category: "Software Development",
    tags: ["qa", "playwright", "api-testing"],
    job_type: "full_time",
    publication_date: "2026-08-10T09:15:00",
    candidate_required_location: "USA, Canada",
    salary: "$90,000 - $110,000",
    description:
      "<p>We are looking for a Senior Quality Engineer.</p><ul><li>5+ years QA experience</li><li>Playwright required</li></ul>",
    ...overrides
  };
}

describe("normalizeRemotiveJob", () => {
  it("produces a job that validates cleanly against the existing JobSchema", () => {
    const normalized = normalizeRemotiveJob(rawJob());
    const result = JobSchema.safeParse(normalized);
    expect(result.success).toBe(true);
  });

  it("maps title/company/description correctly and strips HTML from the description", () => {
    const normalized = normalizeRemotiveJob(rawJob()) as Record<string, unknown>;
    expect(normalized.jobTitle).toBe("Senior Quality Engineer");
    expect(normalized.company).toBe("Acme Remote Co");
    expect(normalized.jobDescription).not.toContain("<p>");
    expect(normalized.jobDescription).not.toContain("<li>");
    expect(normalized.jobDescription).toContain("Senior Quality Engineer");
  });

  it("always sets remoteStatus to REMOTE — Remotive is exclusively a remote-jobs board", () => {
    const normalized = normalizeRemotiveJob(rawJob()) as Record<string, unknown>;
    expect(normalized.remoteStatus).toBe("REMOTE");
  });

  it("preserves the original source URL exactly", () => {
    const normalized = normalizeRemotiveJob(rawJob()) as Record<string, unknown>;
    expect(normalized.sourceUrl).toBe("https://remotive.com/remote-jobs/qa/senior-quality-engineer-123456");
  });

  it("preserves externalJobId from the provider's numeric id", () => {
    const normalized = normalizeRemotiveJob(rawJob({ id: 987654 })) as Record<string, unknown>;
    expect(normalized.externalJobId).toBe("987654");
  });

  it("sets source to 'remotive'", () => {
    const normalized = normalizeRemotiveJob(rawJob()) as Record<string, unknown>;
    expect(normalized.source).toBe("remotive");
  });

  it("parses a clean dollar salary range as the average, with currency USD", () => {
    const normalized = normalizeRemotiveJob(rawJob({ salary: "$90,000 - $110,000" })) as Record<string, unknown>;
    expect(normalized.salary).toBe(100000);
    expect(normalized.currency).toBe("USD");
  });

  it("leaves salary/currency undefined (UNKNOWN) when the salary text is not cleanly numeric", () => {
    const normalized = normalizeRemotiveJob(rawJob({ salary: "Pay per task" })) as Record<string, unknown>;
    expect(normalized.salary).toBeUndefined();
    expect(normalized.currency).toBeUndefined();
  });

  it("leaves salary/currency undefined when the salary field is empty", () => {
    const normalized = normalizeRemotiveJob(rawJob({ salary: "" })) as Record<string, unknown>;
    expect(normalized.salary).toBeUndefined();
  });

  it("uses tags as skills when tags are present", () => {
    const normalized = normalizeRemotiveJob(rawJob({ tags: ["playwright", "sql"] })) as Record<string, unknown>;
    expect(normalized.skills).toEqual(["playwright", "sql"]);
  });

  it("maps a known job_type to the corresponding EmploymentType", () => {
    expect((normalizeRemotiveJob(rawJob({ job_type: "contract" })) as Record<string, unknown>).employmentType).toBe(
      "CONTRACT"
    );
    expect((normalizeRemotiveJob(rawJob({ job_type: "part_time" })) as Record<string, unknown>).employmentType).toBe(
      "PART_TIME"
    );
  });

  it("returns null for an unrecognized job_type rather than guessing a mapping", () => {
    expect(normalizeRemotiveJob(rawJob({ job_type: "gig" }))).toBeNull();
  });

  it("returns null when the description is missing or too short (cannot honestly produce a valid job)", () => {
    expect(normalizeRemotiveJob(rawJob({ description: "" }))).toBeNull();
    expect(normalizeRemotiveJob(rawJob({ description: "<p>Hi</p>" }))).toBeNull();
  });

  it("returns null when required identity fields (title/company/url/id) are missing", () => {
    expect(normalizeRemotiveJob(rawJob({ title: "" }))).toBeNull();
    expect(normalizeRemotiveJob(rawJob({ company_name: "" }))).toBeNull();
    expect(normalizeRemotiveJob(rawJob({ url: "" }))).toBeNull();
    expect(normalizeRemotiveJob(rawJob({ id: undefined }))).toBeNull();
  });

  it("truncates an ISO timestamp publication_date down to YYYY-MM-DD", () => {
    const normalized = normalizeRemotiveJob(rawJob({ publication_date: "2026-08-10T09:15:00" })) as Record<
      string,
      unknown
    >;
    expect(normalized.datePosted).toBe("2026-08-10");
  });

  it("falls back to a chunked-description skills list when tags are empty", () => {
    const normalized = normalizeRemotiveJob(
      rawJob({
        tags: [],
        description: "<p>Line one about the role.</p><p>Line two about requirements.</p>"
      })
    ) as Record<string, unknown>;
    expect(Array.isArray(normalized.skills)).toBe(true);
    expect((normalized.skills as string[]).length).toBeGreaterThan(0);
  });

  it("derives a reasonable country from candidate_required_location, defaulting to Worldwide when absent", () => {
    const withLocation = normalizeRemotiveJob(rawJob({ candidate_required_location: "Germany, Europe" })) as Record<
      string,
      unknown
    >;
    expect(withLocation.country).toBe("Germany");

    const withoutLocation = normalizeRemotiveJob(rawJob({ candidate_required_location: "" })) as Record<
      string,
      unknown
    >;
    expect(withoutLocation.country).toBe("Worldwide");
  });

  it("produces non-empty requirements and responsibilities from the same underlying description text (Remotive doesn't separate them)", () => {
    const normalized = normalizeRemotiveJob(rawJob()) as Record<string, unknown>;
    expect((normalized.requirements as string[]).length).toBeGreaterThan(0);
    expect((normalized.responsibilities as string[]).length).toBeGreaterThan(0);
  });
});
