import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { JobSchema, type Job } from "../schemas/job.js";
import { JobMatchSchema, MATCH_SCORE_LABEL, type JobMatch } from "../schemas/jobMatch.js";
import { TailoredResumeSchema, type TailoredResume } from "../schemas/tailoredResume.js";
import { ResumeQAReportSchema, type ResumeQAReport } from "../schemas/resumeQA.js";
import {
  ApplicationMessageResponseSchema,
  ApplicationPackageSchema,
  type ApplicationPackage,
  type ApplicationPackageFailedResult,
  type ApplicationPackageResult,
  type ApplicationPackageReviewRequiredResult
} from "../schemas/applicationPackage.js";
import { buildApplicationMessageUserPrompt, APPLICATION_MESSAGE_SYSTEM_PROMPT } from "../prompts/applicationMessage.js";
import type { ResumeRelevantProfileFields } from "./profileService.js";
import { CLAUDE_MODEL, CLAUDE_REQUEST_TIMEOUT_MS } from "./claudeClient.js";
import {
  ClaudeApiError,
  ClaudeResponseValidationError,
  InvalidApplicationPackageInputError,
  InvalidClaudeResponseError,
  toSafeErrorMessage
} from "../utils/errors.js";
import { formatZodIssues } from "../utils/zod.js";

// Raised from 800 (2026-08-15): production runs showed "response was not
// valid JSON" — the classic signature of output truncated mid-generation —
// on this step specifically. The requested message itself is short
// (~150 words), but 800 tokens leaves little margin if the model produces
// any reasoning/preamble before the JSON. See docs/DEPLOYMENT.md.
const APPLICATION_MESSAGE_MAX_OUTPUT_TOKENS = 2_000;
// Raised from 2 to 3 attempts, and 429 added to isRetryable() (2026-08-15):
// production runs on Vercel showed transient failures — including a rate
// limit-shaped response and a response with no text content block — on an
// otherwise fresh/low-tier Anthropic account making several sequential
// calls, specifically on this step (the last Claude call in the per-job
// pipeline). See docs/DEPLOYMENT.md.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export interface ApplicationPackageInput {
  /** Unvalidated — all five inputs below are re-validated here, since this is the actual trust boundary. */
  job: unknown;
  jobMatch: unknown;
  careerProfile: ResumeRelevantProfileFields;
  masterResume: string;
  tailoredResume: unknown;
  resumeQA: unknown;
}

export interface ApplicationPackageDependencies {
  claudeClient: Anthropic;
}

// --- Claude call for the application message (no separate agent file per Phase 5 spec §1) ---

interface ClaudeContentBlock {
  type: string;
  text?: unknown;
}
interface ClaudeMessageLike {
  content: ClaudeContentBlock[];
}

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number } | undefined)?.status;
  if (typeof status === "number" && (status >= 500 || status === 429)) {
    return true;
  }
  const name = (error as { name?: string } | undefined)?.name ?? "";
  return name.includes("Timeout") || name.includes("Connection");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractText(message: ClaudeMessageLike): string {
  const block = message.content.find((b) => b.type === "text");
  if (!block || typeof block.text !== "string") {
    throw new InvalidClaudeResponseError("Claude response contained no text content block");
  }
  return block.text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidClaudeResponseError("Claude response was not valid JSON", text);
  }
}

async function generateApplicationMessage(
  job: Job,
  careerProfile: ResumeRelevantProfileFields,
  masterResume: string,
  client: Anthropic
): Promise<string> {
  const userPrompt = buildApplicationMessageUserPrompt(job, careerProfile, masterResume);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const message = (await client.messages.create(
        {
          model: CLAUDE_MODEL,
          max_tokens: APPLICATION_MESSAGE_MAX_OUTPUT_TOKENS,
          system: APPLICATION_MESSAGE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }]
        },
        { timeout: CLAUDE_REQUEST_TIMEOUT_MS }
      )) as unknown as ClaudeMessageLike;

      // TEMPORARY diagnostic — safe shape info only (block types, stop
      // reason, usage), never actual content. Remove once the production
      // "no text content block, every attempt" issue (2026-08-15,
      // application_package stage specifically) is root-caused.
      console.log(
        JSON.stringify({
          source: "career-agent-debug",
          stage: "generateApplicationMessage",
          attempt,
          contentBlockTypes: message.content?.map((b) => b.type),
          stopReason: (message as unknown as { stop_reason?: unknown }).stop_reason,
          usage: (message as unknown as { usage?: unknown }).usage
        })
      );

      const text = extractText(message);
      const parsed = parseJson(text);
      const result = ApplicationMessageResponseSchema.safeParse(parsed);

      if (!result.success) {
        throw new ClaudeResponseValidationError(
          "Claude application-message response failed schema validation",
          formatZodIssues(result.error)
        );
      }

      return result.data.applicationMessage;
    } catch (error) {
      // ClaudeResponseValidationError (well-formed JSON, wrong shape) stays
      // non-retryable — a genuine prompt/model output problem. But an
      // InvalidClaudeResponseError (non-JSON, or no text block at all) is
      // now retried like a transient failure — see the MAX_ATTEMPTS comment
      // above.
      if (error instanceof ClaudeResponseValidationError) {
        throw error;
      }
      if (error instanceof InvalidClaudeResponseError) {
        if (attempt < MAX_ATTEMPTS) {
          await delay(RETRY_DELAY_MS);
          continue;
        }
        throw error;
      }
      if (attempt < MAX_ATTEMPTS && isRetryable(error)) {
        await delay(RETRY_DELAY_MS);
        continue;
      }
      throw new ClaudeApiError(`Claude API call failed: ${toSafeErrorMessage(error)}`, error);
    }
  }

  throw new ClaudeApiError("Claude API call failed after all attempts");
}

// --- Deterministic helpers (no Claude) ---

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

/** Flags any JD-listed skill mentioned in the application message that isn't traceable to the source material — a deterministic safety net, same pattern as resumeTailoringService.ts. */
function findApplicationMessageUnsupportedClaims(
  job: Job,
  applicationMessage: string,
  careerProfile: ResumeRelevantProfileFields,
  masterResume: string
): string[] {
  const sourceText = [masterResume, ...Object.values(careerProfile)].join("\n");
  return job.skills
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((skill) => containsKeyword(applicationMessage, skill) && !containsKeyword(sourceText, skill));
}

function slugify(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Deterministic, code-owned resume version identifier — ROLE_COMPANY_DATE (see Phase 5 spec §6). Never generated by Claude. */
export function generateResumeVersion(job: Job, createdAt: Date): string {
  const datePart = createdAt.toISOString().slice(0, 10).replace(/-/g, "");
  return `${slugify(job.jobTitle)}_${slugify(job.company)}_${datePart}`;
}

// --- Orchestration ---

/**
 * Phase 5: assembles the Application Package once — and only once — Resume
 * QA (Phase 4) has returned PASS. FAIL and REVIEW_REQUIRED are legitimate
 * pipeline outcomes, not error conditions, so both are returned as
 * discriminated results (never thrown); only genuinely invalid/missing
 * input throws InvalidApplicationPackageInputError. The Master Resume
 * string passed in is never mutated or written anywhere — it flows through
 * as read-only source material.
 */
export async function generateApplicationPackage(
  input: ApplicationPackageInput,
  deps: ApplicationPackageDependencies
): Promise<ApplicationPackageResult> {
  const jobResult = JobSchema.safeParse(input.job);
  if (!jobResult.success) {
    throw new InvalidApplicationPackageInputError("Invalid or missing job", formatZodIssues(jobResult.error));
  }
  const job: Job = jobResult.data;

  const jobMatchResult = JobMatchSchema.safeParse(input.jobMatch);
  if (!jobMatchResult.success) {
    throw new InvalidApplicationPackageInputError("Invalid or missing job match", formatZodIssues(jobMatchResult.error));
  }
  const jobMatch: JobMatch = jobMatchResult.data;

  if (!input.careerProfile || Object.keys(input.careerProfile).length === 0) {
    throw new InvalidApplicationPackageInputError("Career profile is empty or unavailable");
  }

  if (!input.masterResume || input.masterResume.trim().length === 0) {
    throw new InvalidApplicationPackageInputError("Master resume is empty or unavailable");
  }

  const tailoredResumeResult = TailoredResumeSchema.safeParse(input.tailoredResume);
  if (!tailoredResumeResult.success) {
    throw new InvalidApplicationPackageInputError(
      "Invalid or missing tailored resume",
      formatZodIssues(tailoredResumeResult.error)
    );
  }
  const tailoredResume: TailoredResume = tailoredResumeResult.data;

  const resumeQAResult = ResumeQAReportSchema.safeParse(input.resumeQA);
  if (!resumeQAResult.success) {
    throw new InvalidApplicationPackageInputError(
      "Invalid or missing resume QA result",
      formatZodIssues(resumeQAResult.error)
    );
  }
  const resumeQA: ResumeQAReport = resumeQAResult.data;

  const jobId = job.externalJobId ?? job.sourceUrl;

  // --- Quality gate: Application Package may only proceed after Resume QA PASS ---
  if (resumeQA.status === "FAIL") {
    const failed: ApplicationPackageFailedResult = {
      status: "FAILED",
      jobId,
      qaStatus: "FAIL",
      reason: "Resume QA returned FAIL — the application package cannot be generated.",
      criticalIssueSummaries: resumeQA.criticalIssues.map((issue) => issue.description)
    };
    return failed;
  }

  if (resumeQA.status === "REVIEW_REQUIRED") {
    const reviewRequired: ApplicationPackageReviewRequiredResult = {
      status: "HUMAN_REVIEW_REQUIRED",
      jobId,
      qaStatus: "REVIEW_REQUIRED",
      reason: "Resume QA requires human review before an application package can be generated."
    };
    return reviewRequired;
  }

  // --- PASS: generate the package ---
  const applicationMessage = await generateApplicationMessage(job, input.careerProfile, input.masterResume, deps.claudeClient);
  const applicationMessageUnsupportedClaims = findApplicationMessageUnsupportedClaims(
    job,
    applicationMessage,
    input.careerProfile,
    input.masterResume
  );

  const createdAt = new Date();
  const resumeVersion = generateResumeVersion(job, createdAt);

  const candidate: ApplicationPackage = {
    applicationId: randomUUID(),
    status: "READY_FOR_REVIEW",

    jobId,
    company: job.company,
    role: job.jobTitle,
    source: job.source,
    sourceUrl: job.sourceUrl,
    matchScore: jobMatch.matchScore,
    resumeVersion,
    qaStatus: "PASS",
    applicationStatus: "READY_FOR_REVIEW",

    job: {
      jobTitle: job.jobTitle,
      company: job.company,
      location: job.location,
      country: job.country,
      remoteStatus: job.remoteStatus,
      sourceUrl: job.sourceUrl,
      salary: job.salary ?? "UNKNOWN",
      currency: job.currency ?? "UNKNOWN"
    },
    jobMatch: {
      matchScore: jobMatch.matchScore,
      matchScoreLabel: MATCH_SCORE_LABEL,
      interviewPotential: jobMatch.interviewPotential,
      careerGrowth: jobMatch.careerGrowth,
      strongMatches: jobMatch.strongMatches,
      transferableSkills: jobMatch.transferableSkills,
      gaps: jobMatch.gaps
    },
    resume: {
      ...tailoredResume,
      resumeVersion
    },
    resumeQA: {
      status: resumeQA.status,
      jdAlignmentScore: resumeQA.jdAlignmentScore,
      factualAccuracyScore: resumeQA.factualAccuracyScore,
      interviewReadinessScore: resumeQA.interviewReadinessScore,
      importantKeywords: resumeQA.supportedKeywords,
      missingKeywords: resumeQA.missingImportantKeywords
    },

    applicationMessage,
    applicationMessageUnsupportedClaims,

    createdAt: createdAt.toISOString()
  };

  return ApplicationPackageSchema.parse(candidate);
}
