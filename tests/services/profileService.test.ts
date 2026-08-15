import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractMasterResumeContent,
  loadCareerProfileForResumeTailoring,
  loadJobDiscoveryPreferences,
  loadJobPreferences,
  loadMasterResume,
  loadResumeRelevantJobPreferences,
  parseCareerProfileMarkdown,
  parseTargetCountriesSection,
  pickRelevantProfileFields,
  pickResumeRelevantProfileFields
} from "../../src/services/profileService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NO_COUNTRIES_FIXTURE = path.resolve(__dirname, "../fixtures/job_preferences_no_countries.md");
const NO_TARGET_ROLES_FIXTURE = path.resolve(__dirname, "../fixtures/job_preferences_no_target_roles.md");
const FULL_JOB_PREFERENCES_FIXTURE = path.resolve(__dirname, "../fixtures/job_preferences_full.md");
const COMMA_LISTS_FIXTURE = path.resolve(__dirname, "../fixtures/job_preferences_comma_lists.md");

const SAMPLE_MARKDOWN = `# Career Profile

## Professional Title
Principal Software Quality Engineer | AI, RAG and LLM Testing Specialist

## Years of Experience
13+ years

## Core Skills
Playwright, API Testing, SQL

## AI Skills
[ADD YOUR INFORMATION]

## Target Countries
- Pakistan
- UAE

## Career Goals
[ADD YOUR INFORMATION]
`;

describe("profileService.parseCareerProfileMarkdown", () => {
  it("splits markdown into heading -> body sections", () => {
    const sections = parseCareerProfileMarkdown(SAMPLE_MARKDOWN);
    expect(sections["Professional Title"]).toBe(
      "Principal Software Quality Engineer | AI, RAG and LLM Testing Specialist"
    );
    expect(sections["Years of Experience"]).toBe("13+ years");
    expect(sections["Core Skills"]).toBe("Playwright, API Testing, SQL");
  });

  it("captures multi-line and list-style section bodies", () => {
    const sections = parseCareerProfileMarkdown(SAMPLE_MARKDOWN);
    expect(sections["Target Countries"]).toContain("Pakistan");
    expect(sections["Target Countries"]).toContain("UAE");
  });
});

describe("profileService.pickRelevantProfileFields", () => {
  it("includes filled, relevant fields", () => {
    const sections = parseCareerProfileMarkdown(SAMPLE_MARKDOWN);
    const picked = pickRelevantProfileFields(sections);

    expect(picked.professionalTitle).toBe(
      "Principal Software Quality Engineer | AI, RAG and LLM Testing Specialist"
    );
    expect(picked.yearsOfExperience).toBe("13+ years");
    expect(picked.coreSkills).toBe("Playwright, API Testing, SQL");
  });

  it("strips out fields that are still the unfilled placeholder", () => {
    const sections = parseCareerProfileMarkdown(SAMPLE_MARKDOWN);
    const picked = pickRelevantProfileFields(sections);

    expect(picked.aiSkills).toBeUndefined();
  });

  it("never includes fields outside the job-matching-relevant set (e.g. career goals, target countries)", () => {
    const sections = parseCareerProfileMarkdown(SAMPLE_MARKDOWN);
    const picked = pickRelevantProfileFields(sections) as Record<string, unknown>;

    expect(picked.careerGoals).toBeUndefined();
    expect(picked.targetCountries).toBeUndefined();
  });

  it("returns an empty object for a profile with no filled sections", () => {
    const emptyMarkdown = "## AI Skills\n[ADD YOUR INFORMATION]\n";
    const picked = pickRelevantProfileFields(parseCareerProfileMarkdown(emptyMarkdown));
    expect(Object.keys(picked)).toHaveLength(0);
  });
});

describe("profileService.parseTargetCountriesSection", () => {
  const SECTION_BODY = [
    "- Pakistan — Islamabad, Rawalpindi",
    "- UAE — Dubai, Abu Dhabi",
    "- Remote / Global — fully remote roles with US/EU-based companies, no relocation required",
    "",
    "### Candidate countries under consideration (not yet active — add when ready)",
    "- Saudi Arabia — Riyadh",
    "- Qatar — Doha",
    "- UK"
  ].join("\n");

  it("extracts only the active country labels, stopping at the nested heading", () => {
    const result = parseTargetCountriesSection(SECTION_BODY);
    expect(result.allowedCountries).toEqual(["Pakistan", "UAE"]);
  });

  it("never includes candidate/not-yet-active countries listed under a nested heading", () => {
    const result = parseTargetCountriesSection(SECTION_BODY);
    expect(result.allowedCountries).not.toContain("Saudi Arabia");
    expect(result.allowedCountries).not.toContain("Qatar");
    expect(result.allowedCountries).not.toContain("UK");
  });

  it("translates a Remote/Global bullet into allowRemoteAnyCountry instead of a literal country", () => {
    const result = parseTargetCountriesSection(SECTION_BODY);
    expect(result.allowRemoteAnyCountry).toBe(true);
    expect(result.allowedCountries).not.toContain("Remote / Global");
  });

  it("returns an empty object for a section with no bullets", () => {
    const result = parseTargetCountriesSection("Some prose, no bullets here.");
    expect(result).toEqual({});
  });

  it("does not invent allowRemoteAnyCountry when no remote/global bullet is present", () => {
    const result = parseTargetCountriesSection("- Pakistan — Islamabad\n- UAE — Dubai");
    expect(result.allowRemoteAnyCountry).toBeUndefined();
    expect(result.allowedCountries).toEqual(["Pakistan", "UAE"]);
  });
});

describe("profileService.loadJobPreferences", () => {
  it("loads real filter defaults from the actual profile/job_preferences.md file", () => {
    const preferences = loadJobPreferences();

    expect(preferences.allowedCountries).toContain("Pakistan");
    expect(preferences.allowedCountries).toContain("UAE");
    expect(preferences.allowRemoteAnyCountry).toBe(true);
  });

  it("never fabricates a minimumSalary — the field simply doesn't exist on the result", () => {
    const preferences = loadJobPreferences() as Record<string, unknown>;
    expect(preferences.minimumSalary).toBeUndefined();
  });

  it("returns an empty object when the Target Countries section is absent from the file", () => {
    const preferences = loadJobPreferences(NO_COUNTRIES_FIXTURE);
    expect(preferences).toEqual({});
  });
});

describe("profileService.pickResumeRelevantProfileFields", () => {
  const RESUME_MARKDOWN = `# Career Profile

## Professional Title
Principal Software Quality Engineer

## Achievements
- 35 to 40% reduction in production defects.

## Certifications
Claude Code 101 (Anthropic, 2026)

## Education
Master of Science in Software Engineering (2011)

## Career Goals
[ADD YOUR INFORMATION]
`;

  it("includes achievements, certifications, and education on top of the job-matching field set", () => {
    const sections = parseCareerProfileMarkdown(RESUME_MARKDOWN);
    const picked = pickResumeRelevantProfileFields(sections);

    expect(picked.professionalTitle).toBe("Principal Software Quality Engineer");
    expect(picked.achievements).toContain("35 to 40%");
    expect(picked.certifications).toBe("Claude Code 101 (Anthropic, 2026)");
    expect(picked.education).toBe("Master of Science in Software Engineering (2011)");
  });

  it("still strips unfilled placeholders (career goals) since those aren't in the resume-relevant set anyway", () => {
    const sections = parseCareerProfileMarkdown(RESUME_MARKDOWN);
    const picked = pickResumeRelevantProfileFields(sections) as Record<string, unknown>;
    expect(picked.careerGoals).toBeUndefined();
  });
});

describe("profileService.loadCareerProfileForResumeTailoring", () => {
  it("loads the real profile including achievements/certifications/education", () => {
    const profile = loadCareerProfileForResumeTailoring();
    expect(profile.professionalTitle).toContain("Principal");
    expect(profile.achievements).toBeDefined();
    expect(profile.certifications).toBeDefined();
    expect(profile.education).toBeDefined();
  });
});

describe("profileService.extractMasterResumeContent", () => {
  it("strips the top-level heading and instructional blockquote, keeping the resume body", () => {
    const markdown = [
      "# Master Resume",
      "",
      "> Paste your full, real resume below. Never extend it.",
      "",
      "## Jane Doe",
      "",
      "Principal Engineer"
    ].join("\n");

    const content = extractMasterResumeContent(markdown);
    expect(content).not.toContain("Paste your full, real resume");
    expect(content).not.toMatch(/^# Master Resume/);
    expect(content).toContain("Jane Doe");
    expect(content).toContain("Principal Engineer");
  });

  it("returns an empty string when the file still shows the unfilled placeholder", () => {
    const markdown = "# Master Resume\n\n> Paste your resume here.\n\n[PASTE MASTER RESUME HERE]\n";
    expect(extractMasterResumeContent(markdown)).toBe("");
  });

  it("returns an empty string for a blank file", () => {
    expect(extractMasterResumeContent("")).toBe("");
  });
});

describe("profileService.loadMasterResume", () => {
  it("loads real, non-placeholder content from the actual profile/master_resume.md file", () => {
    const resume = loadMasterResume();
    expect(resume.length).toBeGreaterThan(0);
    expect(resume).not.toContain("[PASTE MASTER RESUME HERE]");
    expect(resume).not.toContain("Paste your full, real resume");
  });
});

describe("profileService.loadResumeRelevantJobPreferences", () => {
  it("loads the real Target Roles positioning text", () => {
    const preferences = loadResumeRelevantJobPreferences();
    expect(preferences.targetRoles).toBeDefined();
    expect(preferences.targetRoles).toContain("AI Quality Engineering");
  });

  it("returns an empty object when Target Roles is still the unfilled placeholder", () => {
    const preferences = loadResumeRelevantJobPreferences(NO_TARGET_ROLES_FIXTURE);
    expect(preferences).toEqual({});
  });
});

describe("profileService.loadJobDiscoveryPreferences", () => {
  it("parses every configured section from a fully filled file", () => {
    const preferences = loadJobDiscoveryPreferences(FULL_JOB_PREFERENCES_FIXTURE);

    expect(preferences.allowedCountries).toEqual(["Pakistan", "UAE"]);
    expect(preferences.allowRemoteAnyCountry).toBe(true);
    expect(preferences.preferredIndustries).toEqual(["AI / SaaS", "Fintech"]);
    expect(preferences.excludedIndustries).toEqual(["Gambling", "Tobacco"]);
    expect(preferences.preferredTechnologies).toEqual(["Playwright", "Claude API"]);
    expect(preferences.rolesToAvoid).toEqual(["Manual Tester", "Junior QA"]);
    expect(preferences.remotePreference).toContain("Remote preferred");
    expect(preferences.minimumExperience).toBe("8+ years");
  });

  it("treats every currently-unfilled section in the REAL job_preferences.md as not configured (undefined), never invented", () => {
    const preferences = loadJobDiscoveryPreferences();

    // As of this writing these sections are still [ADD YOUR INFORMATION]
    // placeholders in the real file — this test locks in that nothing gets
    // fabricated for them. If the user later fills these in, this specific
    // assertion will need updating — that's expected and correct.
    expect(preferences.preferredIndustries).toBeUndefined();
    expect(preferences.excludedIndustries).toBeUndefined();
    expect(preferences.rolesToAvoid).toBeUndefined();
    expect(preferences.preferredTechnologies).toBeUndefined();
    expect(preferences.remotePreference).toBeUndefined();
    expect(preferences.minimumExperience).toBeUndefined();

    // Target Countries IS filled in the real file, so this should still work.
    expect(preferences.allowedCountries).toContain("Pakistan");
  });

  it("returns an empty object for a file with none of these sections present", () => {
    const preferences = loadJobDiscoveryPreferences(NO_COUNTRIES_FIXTURE);
    expect(preferences).toEqual({});
  });

  it("parses a comma-separated fallback when a section has prose instead of bullets", () => {
    const preferences = loadJobDiscoveryPreferences(COMMA_LISTS_FIXTURE);
    expect(preferences.preferredIndustries).toEqual(["AI", "Fintech", "Healthtech"]);
  });
});
