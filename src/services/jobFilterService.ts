import type { Job } from "../schemas/job.js";

const DEFAULT_JUNIOR_KEYWORDS = [
  "junior",
  "intern",
  "internship",
  "entry level",
  "entry-level",
  "graduate",
  "trainee",
  "apprentice"
];

/** Exported for reuse by jobDiscoveryService.ts, which extends this list with AI-specific terms. */
export const DEFAULT_RELATED_KEYWORDS = [
  "qa",
  "quality assurance",
  "quality engineer",
  "quality",
  "test",
  "testing",
  "sdet",
  "automation"
];

export interface FilterOptions {
  /** ISO-ish country names/codes this candidate can work in for non-remote roles. Omit to disable location filtering. */
  allowedCountries?: string[];
  /** Whether a REMOTE job bypasses the country check. Defaults to true. */
  allowRemoteAnyCountry?: boolean;
  /** Reject jobs with a disclosed salary below this figure. Omit to disable — never inferred or defaulted. */
  minimumSalary?: number;
  juniorKeywords?: string[];
  relatedKeywords?: string[];
  /** From job_preferences.md → "Roles to Avoid". Omit to disable — never defaulted. */
  rolesToAvoid?: string[];
  /** From job_preferences.md → "Excluded Industries". Omit to disable — never defaulted. */
  excludedIndustries?: string[];
}

export interface FilterRejection {
  job: Job;
  reasons: string[];
}

export interface FilterResult {
  eligible: Job[];
  rejected: FilterRejection[];
}

function containsKeyword(haystack: string, keyword: string): boolean {
  const normalizedHaystack = haystack.toLowerCase();
  const normalizedKeyword = keyword.toLowerCase();

  // Short acronyms need word-boundary matching so "qa" doesn't match inside unrelated words.
  if (normalizedKeyword.length <= 4 && !normalizedKeyword.includes(" ")) {
    const pattern = new RegExp(`\\b${normalizedKeyword}\\b`);
    return pattern.test(normalizedHaystack);
  }
  return normalizedHaystack.includes(normalizedKeyword);
}

function jobDedupeKey(job: Job): string {
  if (job.externalJobId) {
    return `id:${job.externalJobId.trim().toLowerCase()}`;
  }
  const normalizedUrl = job.sourceUrl.trim().toLowerCase().replace(/\/+$/, "");
  if (normalizedUrl) {
    return `url:${normalizedUrl}`;
  }
  return `composite:${job.jobTitle.trim().toLowerCase()}|${job.company.trim().toLowerCase()}|${job.location
    .trim()
    .toLowerCase()}`;
}

/**
 * Merges job_preferences.md-derived defaults with caller-supplied overrides.
 * A key is only overridden when the caller's object explicitly includes it —
 * omitted keys fall through to the file default, never to a hardcoded one.
 */
export function mergeFilterOptions(defaults: FilterOptions, overrides: FilterOptions = {}): FilterOptions {
  return { ...defaults, ...overrides };
}

/** Removes exact-duplicate job postings (same externalJobId, or same sourceUrl, or same title+company+location). */
export function deduplicateJobs(jobs: Job[]): Job[] {
  const seen = new Set<string>();
  const result: Job[] = [];

  for (const job of jobs) {
    const key = jobDedupeKey(job);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(job);
    }
  }

  return result;
}

/**
 * Rejects obvious structural mismatches before any job is sent to Claude.
 * This never evaluates skill/qualification fit — that's Claude's job. A job
 * is only rejected here for reasons a deterministic rule can state with
 * certainty (explicit location mismatch, explicit junior title, no QA/testing
 * signal at all, missing description, or salary below an explicit floor).
 */
export function filterEligibleJobs(jobs: Job[], options: FilterOptions = {}): FilterResult {
  const juniorKeywords = options.juniorKeywords ?? DEFAULT_JUNIOR_KEYWORDS;
  const relatedKeywords = options.relatedKeywords ?? DEFAULT_RELATED_KEYWORDS;
  const allowRemoteAnyCountry = options.allowRemoteAnyCountry ?? true;

  const eligible: Job[] = [];
  const rejected: FilterRejection[] = [];

  for (const job of jobs) {
    const reasons: string[] = [];

    if (job.jobDescription.trim().length === 0) {
      reasons.push("job description is missing");
    }

    const matchedJuniorKeyword = juniorKeywords.find((keyword) => containsKeyword(job.jobTitle, keyword));
    if (matchedJuniorKeyword) {
      reasons.push(`title indicates a junior/entry-level role (matched "${matchedJuniorKeyword}")`);
    }

    const searchableText = [job.jobTitle, job.skills.join(" "), job.jobDescription].join(" ");
    const hasRelatedSignal = relatedKeywords.some((keyword) => containsKeyword(searchableText, keyword));
    if (!hasRelatedSignal) {
      reasons.push("no QA/testing/quality-related signal found in title, skills, or description");
    }

    if (options.allowedCountries && options.allowedCountries.length > 0) {
      const isRemoteExempt = job.remoteStatus === "REMOTE" && allowRemoteAnyCountry;
      const countryAllowed = options.allowedCountries.some(
        (country) => country.trim().toLowerCase() === job.country.trim().toLowerCase()
      );
      if (!isRemoteExempt && !countryAllowed) {
        reasons.push(`location "${job.country}" is not in the supported country list`);
      }
    }

    if (options.minimumSalary !== undefined && job.salary !== undefined && job.salary < options.minimumSalary) {
      reasons.push(`disclosed salary (${job.salary}) is below the minimum (${options.minimumSalary})`);
    }

    if (options.rolesToAvoid && options.rolesToAvoid.length > 0) {
      const matchedAvoidedRole = options.rolesToAvoid.find((role) => containsKeyword(job.jobTitle, role));
      if (matchedAvoidedRole) {
        reasons.push(`title matches an explicitly avoided role ("${matchedAvoidedRole}")`);
      }
    }

    if (options.excludedIndustries && options.excludedIndustries.length > 0) {
      const searchableIndustryText = [job.company, job.jobDescription].join(" ");
      const matchedExcludedIndustry = options.excludedIndustries.find((industry) =>
        containsKeyword(searchableIndustryText, industry)
      );
      if (matchedExcludedIndustry) {
        reasons.push(`appears to match an excluded industry ("${matchedExcludedIndustry}")`);
      }
    }

    if (reasons.length > 0) {
      rejected.push({ job, reasons });
    } else {
      eligible.push(job);
    }
  }

  return { eligible, rejected };
}
