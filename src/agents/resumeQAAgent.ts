import type Anthropic from "@anthropic-ai/sdk";
import type { Job } from "../schemas/job.js";
import { ResumeQAReportSchema, type ResumeQAReport } from "../schemas/resumeQA.js";
import { buildResumeQAUserPrompt, RESUME_QA_SYSTEM_PROMPT } from "../prompts/resumeQA.js";
import type { TailoredResume } from "../schemas/tailoredResume.js";
import type { ResumeEvidenceReport } from "../schemas/resumeEvidence.js";
import type { ResumeRelevantProfileFields } from "../services/profileService.js";
import { CLAUDE_MODEL, CLAUDE_REQUEST_TIMEOUT_MS } from "../services/claudeClient.js";
import {
  ClaudeApiError,
  ClaudeResponseValidationError,
  InvalidClaudeResponseError,
  toSafeErrorMessage
} from "../utils/errors.js";
import { formatZodIssues } from "../utils/zod.js";

// A full 20-dimension QA pass over a whole resume needs a larger output
// budget than a single match assessment or evidence-claim extraction.
const RESUME_QA_MAX_OUTPUT_TOKENS = 4_500;

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

interface ReviewTailoredResumeDependencies {
  client: Anthropic;
}

interface ClaudeContentBlock {
  type: string;
  text?: unknown;
}

interface ClaudeMessageLike {
  content: ClaudeContentBlock[];
}

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number } | undefined)?.status;
  if (typeof status === "number" && status >= 500) {
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

/**
 * Independent QA pass over an already-tailored resume. Never rewrites
 * anything — only reviews and reports. Same retry/error posture as the
 * other three agents; duplicated rather than shared, consistent with the
 * trade-off already made in Phases 3 and 3.1.
 */
export async function reviewTailoredResume(
  job: Job,
  careerProfile: ResumeRelevantProfileFields,
  masterResume: string,
  tailoredResume: TailoredResume,
  evidenceGuardResult: ResumeEvidenceReport,
  { client }: ReviewTailoredResumeDependencies
): Promise<ResumeQAReport> {
  const userPrompt = buildResumeQAUserPrompt(job, careerProfile, masterResume, tailoredResume, evidenceGuardResult);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const message = (await client.messages.create(
        {
          model: CLAUDE_MODEL,
          max_tokens: RESUME_QA_MAX_OUTPUT_TOKENS,
          system: RESUME_QA_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }]
        },
        { timeout: CLAUDE_REQUEST_TIMEOUT_MS }
      )) as unknown as ClaudeMessageLike;

      const text = extractText(message);
      const parsed = parseJson(text);
      const result = ResumeQAReportSchema.safeParse(parsed);

      if (!result.success) {
        throw new ClaudeResponseValidationError(
          "Claude resume-QA response failed schema validation",
          formatZodIssues(result.error)
        );
      }

      return result.data;
    } catch (error) {
      if (error instanceof InvalidClaudeResponseError || error instanceof ClaudeResponseValidationError) {
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
