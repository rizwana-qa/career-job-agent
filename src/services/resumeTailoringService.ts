import type Anthropic from "@anthropic-ai/sdk";
import { JobSchema, type Job } from "../schemas/job.js";
import { TAILORED_RESUME_STATUS, type TailoredResume } from "../schemas/tailoredResume.js";
import { tailorResume } from "../agents/resumeTailoringAgent.js";
import type { ResumeRelevantJobPreferences, ResumeRelevantProfileFields } from "./profileService.js";
import { InvalidTailoringInputError } from "../utils/errors.js";
import { formatZodIssues } from "../utils/zod.js";

export const JD_KEYWORD_ALIGNMENT_LABEL = "JD Keyword Alignment";

export interface JdKeywordAlignment {
  label: string;
  score: number;
  supportedKeywords: string[];
  missingKeywords: string[];
  unsupportedKeywords: string[];
}

export interface TailoredResumeResult extends TailoredResume {
  jdKeywordAlignment: JdKeywordAlignment;
  /**
   * coreSkills/certifications entries in Claude's output that aren't
   * traceable to the master resume or career profile text — a deterministic
   * hallucination safety net. This does NOT check free-text claims inside
   * professionalSummary, experience bullets, or tailoredResume (see Known
   * Limitations in the Phase 3 report) — only these two structured arrays.
   */
  unsupportedClaims: string[];
}

export interface TailorResumeInput {
  /** Unvalidated — this service re-validates it, since it's the actual trust boundary. */
  job: unknown;
  careerProfile: ResumeRelevantProfileFields;
  masterResume: string;
  jobPreferences?: ResumeRelevantJobPreferences;
}

export interface TailorResumeDependencies {
  claudeClient: Anthropic;
}

/** Case-insensitive match; short acronyms (<=4 chars, no spaces) require a word boundary so "SQL" doesn't match inside an unrelated word. */
function containsKeyword(haystack: string, keyword: string): boolean {
  const normalizedHaystack = haystack.toLowerCase();
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return false;
  }
  if (normalizedKeyword.length <= 4 && !normalizedKeyword.includes(" ")) {
    const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(normalizedHaystack);
  }
  return normalizedHaystack.includes(normalizedKeyword);
}

function buildSourceText(careerProfile: ResumeRelevantProfileFields, masterResume: string): string {
  return [masterResume, ...Object.values(careerProfile)].join("\n");
}

/**
 * Deterministic (no Claude): every JD-listed skill is classified against
 * whether the candidate's real source materials support it. This is the
 * literal "JD Keyword Alignment" from the Phase 3 spec — never labeled as an
 * ATS score, and never used to justify adding an unsupported keyword.
 */
export function calculateJdKeywordAlignment(
  job: Job,
  tailored: Pick<TailoredResume, "professionalSummary" | "coreSkills" | "tailoredResume">,
  sourceText: string
): JdKeywordAlignment {
  const tailoredText = [tailored.professionalSummary, tailored.coreSkills.join(" "), tailored.tailoredResume].join(
    "\n"
  );
  const keywords = Array.from(new Set(job.skills.map((skill) => skill.trim()).filter(Boolean)));

  const supportedKeywords: string[] = [];
  const missingKeywords: string[] = [];
  const unsupportedKeywords: string[] = [];

  for (const keyword of keywords) {
    if (containsKeyword(sourceText, keyword)) {
      supportedKeywords.push(keyword);
    } else if (containsKeyword(tailoredText, keyword)) {
      unsupportedKeywords.push(keyword);
    } else {
      missingKeywords.push(keyword);
    }
  }

  const score = keywords.length === 0 ? 0 : Math.round((supportedKeywords.length / keywords.length) * 100);

  return { label: JD_KEYWORD_ALIGNMENT_LABEL, score, supportedKeywords, missingKeywords, unsupportedKeywords };
}

/**
 * Deterministic safety net: flags coreSkills/certifications entries Claude
 * included that don't appear anywhere in the source materials. Scoped
 * narrowly on purpose — see TailoredResumeResult.unsupportedClaims doc.
 */
export function findUnsupportedClaims(tailored: TailoredResume, sourceText: string): string[] {
  const claims = [...tailored.coreSkills, ...tailored.certifications];
  return claims.filter((claim) => !containsKeyword(sourceText, claim));
}

/**
 * Phase 3 orchestration: Job + Career Profile + Master Resume -> Claude
 * tailoring -> schema validation -> deterministic keyword/claim checks ->
 * READY_FOR_RESUME_QA. This never marks anything as approved — the status
 * is always exactly READY_FOR_RESUME_QA, a human/Resume QA phase decides
 * what happens next.
 */
export async function tailorResumeForJob(
  input: TailorResumeInput,
  deps: TailorResumeDependencies
): Promise<TailoredResumeResult> {
  const jobResult = JobSchema.safeParse(input.job);
  if (!jobResult.success) {
    throw new InvalidTailoringInputError("Invalid or missing job", formatZodIssues(jobResult.error));
  }
  const job = jobResult.data;

  if (!input.careerProfile || Object.keys(input.careerProfile).length === 0) {
    throw new InvalidTailoringInputError("Career profile is empty or unavailable");
  }

  if (!input.masterResume || input.masterResume.trim().length === 0) {
    throw new InvalidTailoringInputError("Master resume is empty or unavailable");
  }

  const rawResult = await tailorResume(job, input.careerProfile, input.masterResume, input.jobPreferences, {
    client: deps.claudeClient
  });

  const tailored: TailoredResume = {
    ...rawResult,
    jobId: job.externalJobId ?? job.sourceUrl,
    targetRole: job.jobTitle,
    targetCompany: job.company,
    status: TAILORED_RESUME_STATUS
  };

  const sourceText = buildSourceText(input.careerProfile, input.masterResume);
  const jdKeywordAlignment = calculateJdKeywordAlignment(job, tailored, sourceText);
  const unsupportedClaims = findUnsupportedClaims(tailored, sourceText);

  return { ...tailored, jdKeywordAlignment, unsupportedClaims };
}
