import type Anthropic from "@anthropic-ai/sdk";
import type { Job } from "../schemas/job.js";
import { TailoredResumeSchema, type TailoredResume } from "../schemas/tailoredResume.js";
import { buildResumeTailoringUserPrompt, RESUME_TAILORING_SYSTEM_PROMPT } from "../prompts/resumeTailoring.js";
import type { ResumeRelevantJobPreferences, ResumeRelevantProfileFields } from "../services/profileService.js";
import { CLAUDE_MODEL, CLAUDE_REQUEST_TIMEOUT_MS } from "../services/claudeClient.js";
import {
  ClaudeApiError,
  ClaudeResponseValidationError,
  InvalidClaudeResponseError,
  toSafeErrorMessage
} from "../utils/errors.js";
import { formatZodIssues } from "../utils/zod.js";

// Resume tailoring output is substantially larger than a job-match assessment
// (a full resume plus requirement mappings), so it gets a larger output budget.
const RESUME_TAILORING_MAX_OUTPUT_TOKENS = 4_000;

// Raised from 2 to 3 attempts, and 429 added to isRetryable() (2026-08-15):
// production runs on Vercel showed transient failures — including a rate
// limit-shaped response and a response with no text content block — on an
// otherwise fresh/low-tier Anthropic account making several sequential
// calls. See docs/DEPLOYMENT.md.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

interface TailorResumeDependencies {
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

/**
 * Tailors the candidate's master resume to one job via Claude, and validates
 * the response through TailoredResumeSchema. Same retry/error posture as
 * jobMatchingAgent.matchJobToProfile — duplicated here rather than shared,
 * to avoid touching the Phase 2 agent for a Phase 3 change.
 */
export async function tailorResume(
  job: Job,
  careerProfile: ResumeRelevantProfileFields,
  masterResume: string,
  jobPreferences: ResumeRelevantJobPreferences | undefined,
  { client }: TailorResumeDependencies
): Promise<TailoredResume> {
  const userPrompt = buildResumeTailoringUserPrompt(job, careerProfile, masterResume, jobPreferences);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const message = (await client.messages.create(
        {
          model: CLAUDE_MODEL,
          max_tokens: RESUME_TAILORING_MAX_OUTPUT_TOKENS,
          system: RESUME_TAILORING_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }]
        },
        { timeout: CLAUDE_REQUEST_TIMEOUT_MS }
      )) as unknown as ClaudeMessageLike;

      const text = extractText(message);
      const parsed = parseJson(text);
      const result = TailoredResumeSchema.safeParse(parsed);

      if (!result.success) {
        throw new ClaudeResponseValidationError(
          "Claude resume-tailoring response failed schema validation",
          formatZodIssues(result.error)
        );
      }

      return result.data;
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
