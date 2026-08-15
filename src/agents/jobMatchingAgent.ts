import type Anthropic from "@anthropic-ai/sdk";
import type { Job } from "../schemas/job.js";
import { JobMatchSchema, type JobMatch } from "../schemas/jobMatch.js";
import { buildJobMatchingUserPrompt, JOB_MATCHING_SYSTEM_PROMPT } from "../prompts/jobMatching.js";
import type { RelevantProfileFields } from "../services/profileService.js";
import { CLAUDE_MAX_OUTPUT_TOKENS, CLAUDE_MODEL, CLAUDE_REQUEST_TIMEOUT_MS } from "../services/claudeClient.js";
import {
  ClaudeApiError,
  ClaudeResponseValidationError,
  InvalidClaudeResponseError,
  toSafeErrorMessage
} from "../utils/errors.js";
import { formatZodIssues } from "../utils/zod.js";

// Raised from 2 to 3 attempts, and 429 added to isRetryable() (2026-08-15):
// production runs on Vercel showed transient failures — including a rate
// limit-shaped response and a response with no text content block — on an
// otherwise fresh/low-tier Anthropic account making several sequential
// calls. See docs/DEPLOYMENT.md.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

interface MatchJobDependencies {
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
 * Evaluates a single job against the candidate's profile via Claude, and
 * validates the response through JobMatchSchema before returning it. Retries
 * once on a transient failure (timeout / 5xx); never retries on a structurally
 * invalid response, since that's a prompt/model problem, not a network one.
 */
export async function matchJobToProfile(
  job: Job,
  profile: RelevantProfileFields,
  { client }: MatchJobDependencies
): Promise<JobMatch> {
  const userPrompt = buildJobMatchingUserPrompt(job, profile);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const message = (await client.messages.create(
        {
          model: CLAUDE_MODEL,
          max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
          // Explicit adaptive thinking — see resumeTailoringAgent.ts for why
          // disabling it is unsafe for structured-output calls on this model.
          // `thinking` predates this SDK's (0.32.1) types but is a real field
          // the client passes straight through to the request body.
          thinking: { type: "adaptive" },
          system: JOB_MATCHING_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }]
        } as Anthropic.MessageCreateParamsNonStreaming,
        { timeout: CLAUDE_REQUEST_TIMEOUT_MS }
      )) as unknown as ClaudeMessageLike;

      const text = extractText(message);
      const parsed = parseJson(text);
      const result = JobMatchSchema.safeParse(parsed);

      if (!result.success) {
        throw new ClaudeResponseValidationError(
          "Claude response failed schema validation",
          formatZodIssues(result.error)
        );
      }

      return result.data;
    } catch (error) {
      // ClaudeResponseValidationError (well-formed JSON, wrong shape) stays
      // non-retryable — a genuine prompt/model output problem. But an
      // InvalidClaudeResponseError (non-JSON, or no text block at all) is
      // now retried like a transient failure: production evidence showed a
      // "no text content block" response immediately after several
      // successful calls in the same run, which points to something
      // transient on Anthropic's/the network's side rather than a
      // persistent structural issue.
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

  // Unreachable — the loop above always returns or throws — but keeps TypeScript satisfied.
  throw new ClaudeApiError("Claude API call failed after all attempts");
}
