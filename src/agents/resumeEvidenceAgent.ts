import type Anthropic from "@anthropic-ai/sdk";
import { ResumeEvidenceReportSchema, type ResumeEvidenceReport } from "../schemas/resumeEvidence.js";
import { buildResumeEvidenceUserPrompt, RESUME_EVIDENCE_SYSTEM_PROMPT } from "../prompts/resumeEvidence.js";
import type { TailoredResume } from "../schemas/tailoredResume.js";
import type { ResumeRelevantProfileFields } from "../services/profileService.js";
import { CLAUDE_MODEL, CLAUDE_REQUEST_TIMEOUT_MS } from "../services/claudeClient.js";
import {
  ClaudeApiError,
  ClaudeResponseValidationError,
  InvalidClaudeResponseError,
  toSafeErrorMessage
} from "../utils/errors.js";
import { formatZodIssues } from "../utils/zod.js";

// Claim extraction + evidence reasoning across a full resume needs a larger
// output budget than a single match assessment.
const RESUME_EVIDENCE_MAX_OUTPUT_TOKENS = 4_000;

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

interface VerifyResumeEvidenceDependencies {
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
 * Independent claim-verification pass over a tailored resume's free text
 * (professionalSummary, experience bullets, tailoredResume). Claude here
 * only extracts and classifies claims — it never rewrites the resume. Same
 * retry/error posture as the other two agents; duplicated rather than
 * shared, consistent with the trade-off already made in Phase 3.
 */
export async function verifyResumeEvidence(
  masterResume: string,
  careerProfile: ResumeRelevantProfileFields,
  tailoredResume: TailoredResume,
  { client }: VerifyResumeEvidenceDependencies
): Promise<ResumeEvidenceReport> {
  const userPrompt = buildResumeEvidenceUserPrompt(masterResume, careerProfile, tailoredResume);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const message = (await client.messages.create(
        {
          model: CLAUDE_MODEL,
          max_tokens: RESUME_EVIDENCE_MAX_OUTPUT_TOKENS,
          system: RESUME_EVIDENCE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }]
        },
        { timeout: CLAUDE_REQUEST_TIMEOUT_MS }
      )) as unknown as ClaudeMessageLike;

      const text = extractText(message);
      const parsed = parseJson(text);
      const result = ResumeEvidenceReportSchema.safeParse(parsed);

      if (!result.success) {
        throw new ClaudeResponseValidationError(
          "Claude resume-evidence response failed schema validation",
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
