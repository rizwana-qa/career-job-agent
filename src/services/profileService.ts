import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PLACEHOLDER_MARKER = "[ADD YOUR INFORMATION]";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROFILE_PATH = path.resolve(__dirname, "../../profile/career_profile.md");
const DEFAULT_JOB_PREFERENCES_PATH = path.resolve(__dirname, "../../profile/job_preferences.md");
const DEFAULT_MASTER_RESUME_PATH = path.resolve(__dirname, "../../profile/master_resume.md");
const MASTER_RESUME_PLACEHOLDER = "[PASTE MASTER RESUME HERE]";

/**
 * The fields the Job Matching Agent actually needs to evaluate fit, in the
 * same order as the categories it's asked to score. Deliberately excludes
 * target countries, salary, career goals, certifications, and education —
 * not relevant to a single job-fit evaluation, and keeping them out keeps
 * the Claude prompt concise (see docs/AGENTS.md — token control).
 */
export interface RelevantProfileFields {
  professionalTitle?: string;
  yearsOfExperience?: string;
  coreSkills?: string;
  aiSkills?: string;
  llmSkills?: string;
  ragSkills?: string;
  aiAgentTesting?: string;
  automation?: string;
  playwright?: string;
  apiTesting?: string;
  qualityEngineering?: string;
  leadership?: string;
  architecture?: string;
  domainExperience?: string;
}

const SECTION_TO_FIELD: Record<string, keyof RelevantProfileFields> = {
  "Professional Title": "professionalTitle",
  "Years of Experience": "yearsOfExperience",
  "Core Skills": "coreSkills",
  "AI Skills": "aiSkills",
  "LLM Skills": "llmSkills",
  "RAG Skills": "ragSkills",
  "AI Agent Testing": "aiAgentTesting",
  Automation: "automation",
  Playwright: "playwright",
  "API Testing": "apiTesting",
  "Quality Engineering": "qualityEngineering",
  Leadership: "leadership",
  Architecture: "architecture",
  "Domain Experience": "domainExperience"
};

function isPlaceholder(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0 || trimmed.includes(PLACEHOLDER_MARKER);
}

/**
 * Pure parser: splits a career_profile.md-shaped markdown string into
 * `## Heading` -> body sections. No file I/O, so it's directly testable.
 */
export function parseCareerProfileMarkdown(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = markdown.split("\n");

  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentHeading) {
      sections[currentHeading] = currentBody.join("\n").trim();
    }
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim();
      currentBody = [];
    } else if (currentHeading) {
      currentBody.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * Picks only the fields relevant to job matching and drops anything still
 * showing the unfilled placeholder marker, so an incomplete profile never
 * gets sent to Claude as if it were real data.
 */
export function pickRelevantProfileFields(sections: Record<string, string>): RelevantProfileFields {
  const result: RelevantProfileFields = {};

  for (const [heading, field] of Object.entries(SECTION_TO_FIELD)) {
    const value = sections[heading];
    if (value && !isPlaceholder(value)) {
      result[field] = value;
    }
  }

  return result;
}

export function loadCareerProfile(filePath: string = DEFAULT_PROFILE_PATH): RelevantProfileFields {
  const markdown = readFileSync(filePath, "utf-8");
  const sections = parseCareerProfileMarkdown(markdown);
  return pickRelevantProfileFields(sections);
}

/**
 * Deterministic filter defaults derivable from profile/job_preferences.md.
 * Deliberately narrow: only "Target Countries" currently maps to anything
 * jobFilterService understands. Minimum salary is intentionally NOT parsed
 * from here — job_preferences.md states no fixed number on purpose (see its
 * Compensation Strategy section), and inventing one from prose would violate
 * CLAUDE.md rule 5. Preferred/Excluded Industries, Roles to Avoid, and
 * Preferred Technologies are still unfilled placeholders in the source file
 * as of this writing, so there is nothing there to map yet either.
 */
export interface JobPreferenceFilterDefaults {
  allowedCountries?: string[];
  allowRemoteAnyCountry?: boolean;
}

const TARGET_COUNTRIES_HEADING = "Target Countries";

/**
 * Pure parser for the "Target Countries" section body. Only reads bullets
 * before any nested heading (e.g. "### Candidate countries under
 * consideration") — those are explicitly marked "not yet active" in the
 * source file and must not be treated as live preferences. A bullet whose
 * label mentions "remote"/"global" isn't a literal country a job's `country`
 * field could ever equal, so it's translated into `allowRemoteAnyCountry`
 * instead of being added to the country list.
 */
export function parseTargetCountriesSection(sectionBody: string): JobPreferenceFilterDefaults {
  const countries: string[] = [];
  let allowRemoteAnyCountry: boolean | undefined;

  for (const line of sectionBody.split("\n")) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("#")) {
      break; // nested heading — stop before "not yet active" candidate entries
    }

    const bulletMatch = trimmedLine.match(/^-\s+(.+)$/);
    if (!bulletMatch) {
      continue;
    }

    const label = bulletMatch[1].split("—")[0].trim();
    if (!label) {
      continue;
    }

    if (/remote|global/i.test(label)) {
      allowRemoteAnyCountry = true;
      continue;
    }

    countries.push(label);
  }

  const result: JobPreferenceFilterDefaults = {};
  if (countries.length > 0) {
    result.allowedCountries = countries;
  }
  if (allowRemoteAnyCountry !== undefined) {
    result.allowRemoteAnyCountry = allowRemoteAnyCountry;
  }
  return result;
}

export function loadJobPreferences(filePath: string = DEFAULT_JOB_PREFERENCES_PATH): JobPreferenceFilterDefaults {
  const markdown = readFileSync(filePath, "utf-8");
  const sections = parseCareerProfileMarkdown(markdown);
  const targetCountriesBody = sections[TARGET_COUNTRIES_HEADING];
  if (!targetCountriesBody) {
    return {};
  }
  return parseTargetCountriesSection(targetCountriesBody);
}

// ---------------------------------------------------------------------------
// Phase 3: Resume Tailoring — additional profile/job_preferences.md readers.
// ---------------------------------------------------------------------------

/**
 * Resume tailoring needs more of the career profile than job matching does —
 * achievements, certifications, and education are real content that can end
 * up in a tailored resume, not just fit-scoring signals. This is a superset
 * of RelevantProfileFields, not a replacement for it — job matching keeps
 * using the narrower set so its prompt stays concise.
 */
export interface ResumeRelevantProfileFields extends RelevantProfileFields {
  achievements?: string;
  certifications?: string;
  education?: string;
}

const RESUME_SECTION_TO_FIELD: Record<string, keyof ResumeRelevantProfileFields> = {
  ...SECTION_TO_FIELD,
  Achievements: "achievements",
  Certifications: "certifications",
  Education: "education"
};

export function pickResumeRelevantProfileFields(sections: Record<string, string>): ResumeRelevantProfileFields {
  const result: ResumeRelevantProfileFields = {};

  for (const [heading, field] of Object.entries(RESUME_SECTION_TO_FIELD)) {
    const value = sections[heading];
    if (value && !isPlaceholder(value)) {
      (result as Record<string, string>)[field] = value;
    }
  }

  return result;
}

export function loadCareerProfileForResumeTailoring(
  filePath: string = DEFAULT_PROFILE_PATH
): ResumeRelevantProfileFields {
  const markdown = readFileSync(filePath, "utf-8");
  const sections = parseCareerProfileMarkdown(markdown);
  return pickResumeRelevantProfileFields(sections);
}

/**
 * Strips the file's leading title and instructional blockquote, leaving only
 * the actual resume content. Returns an empty string if the file is still
 * showing the unfilled "[PASTE MASTER RESUME HERE]" placeholder — callers
 * must treat that the same as "no master resume available", never as real
 * content.
 */
export function extractMasterResumeContent(markdown: string): string {
  const contentLines = markdown
    .split("\n")
    .filter((line) => !line.trim().startsWith(">") && !/^#\s+Master Resume\s*$/i.test(line.trim()));

  const content = contentLines.join("\n").trim();
  if (content.length === 0 || content.includes(MASTER_RESUME_PLACEHOLDER)) {
    return "";
  }
  return content;
}

export function loadMasterResume(filePath: string = DEFAULT_MASTER_RESUME_PATH): string {
  const markdown = readFileSync(filePath, "utf-8");
  return extractMasterResumeContent(markdown);
}

/**
 * The only part of job_preferences.md that's useful for resume *wording*
 * (as opposed to job filtering) is the Target Roles positioning language —
 * it helps Claude frame the professional summary consistently with how the
 * candidate wants to be positioned. Everything else in that file (salary
 * strategy, excluded industries, etc.) isn't resume content.
 */
export interface ResumeRelevantJobPreferences {
  targetRoles?: string;
}

export function loadResumeRelevantJobPreferences(
  filePath: string = DEFAULT_JOB_PREFERENCES_PATH
): ResumeRelevantJobPreferences {
  const markdown = readFileSync(filePath, "utf-8");
  const sections = parseCareerProfileMarkdown(markdown);
  const targetRoles = sections["Target Roles"];
  if (targetRoles && !isPlaceholder(targetRoles)) {
    return { targetRoles };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Phase 6: Job Discovery — additional profile/job_preferences.md readers.
// ---------------------------------------------------------------------------

/**
 * Everything job discovery needs from job_preferences.md, beyond what
 * loadJobPreferences() (Phase 2) already covers. As of this writing,
 * Preferred Industries, Excluded Industries, Roles to Avoid, Preferred
 * Technologies, Remote/Hybrid/Onsite Preference, and Minimum Experience are
 * all still unfilled placeholders in the real file — every field here is
 * `undefined` until the user fills in the corresponding section, per
 * CLAUDE.md rule 1 ("never invent"). No field is ever defaulted.
 */
export interface JobDiscoveryPreferences extends JobPreferenceFilterDefaults {
  preferredIndustries?: string[];
  excludedIndustries?: string[];
  rolesToAvoid?: string[];
  preferredTechnologies?: string[];
  /** Free text, since the file doesn't establish a fixed enum for this. */
  remotePreference?: string;
  /** Free text, since the file doesn't establish a fixed format for this. */
  minimumExperience?: string;
}

/**
 * Parses a job_preferences.md section body as a list — bullets if present
 * (same "- Label — details" convention as Target Countries), otherwise a
 * comma-separated line of prose. Returns undefined for an unfilled/missing
 * section — never an empty array standing in for "not configured".
 */
function parseListSection(sectionBody: string | undefined): string[] | undefined {
  if (!sectionBody || isPlaceholder(sectionBody)) {
    return undefined;
  }

  const bulletLines = sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"));

  if (bulletLines.length > 0) {
    const items = bulletLines
      .map((line) => line.replace(/^-\s*/, "").split("—")[0].trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }

  const items = sectionBody
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseTextSection(sectionBody: string | undefined): string | undefined {
  if (!sectionBody || isPlaceholder(sectionBody)) {
    return undefined;
  }
  return sectionBody.trim();
}

export function loadJobDiscoveryPreferences(
  filePath: string = DEFAULT_JOB_PREFERENCES_PATH
): JobDiscoveryPreferences {
  const markdown = readFileSync(filePath, "utf-8");
  const sections = parseCareerProfileMarkdown(markdown);
  const targetCountriesBody = sections[TARGET_COUNTRIES_HEADING];
  const countryDefaults = targetCountriesBody ? parseTargetCountriesSection(targetCountriesBody) : {};

  const result: JobDiscoveryPreferences = { ...countryDefaults };

  const preferredIndustries = parseListSection(sections["Preferred Industries"]);
  if (preferredIndustries) result.preferredIndustries = preferredIndustries;

  const excludedIndustries = parseListSection(sections["Excluded Industries"]);
  if (excludedIndustries) result.excludedIndustries = excludedIndustries;

  const rolesToAvoid = parseListSection(sections["Roles to Avoid"]);
  if (rolesToAvoid) result.rolesToAvoid = rolesToAvoid;

  const preferredTechnologies = parseListSection(sections["Preferred Technologies"]);
  if (preferredTechnologies) result.preferredTechnologies = preferredTechnologies;

  const remotePreference = parseTextSection(sections["Remote / Hybrid / Onsite Preference"]);
  if (remotePreference) result.remotePreference = remotePreference;

  const minimumExperience = parseTextSection(sections["Minimum Experience"]);
  if (minimumExperience) result.minimumExperience = minimumExperience;

  return result;
}
