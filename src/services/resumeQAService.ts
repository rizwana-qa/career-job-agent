import type Anthropic from "@anthropic-ai/sdk";
import { JobSchema } from "../schemas/job.js";
import { TailoredResumeSchema, type TailoredResume } from "../schemas/tailoredResume.js";
import { ResumeEvidenceReportSchema, type ResumeEvidenceReport } from "../schemas/resumeEvidence.js";
import { type QAIssue, type ResumeQAReport } from "../schemas/resumeQA.js";
import { reviewTailoredResume } from "../agents/resumeQAAgent.js";
import type { ResumeRelevantProfileFields } from "./profileService.js";
import { InvalidQAInputError } from "../utils/errors.js";
import { formatZodIssues } from "../utils/zod.js";

export interface ResumeQAInput {
  /** Unvalidated — this service re-validates it, since it's the actual trust boundary. */
  job: unknown;
  careerProfile: ResumeRelevantProfileFields;
  masterResume: string;
  /** Unvalidated — the tailored resume is an untrusted generated artifact (see Phase 4 spec). */
  tailoredResume: unknown;
  /** Unvalidated — the Evidence Guard result is also not assumed correct; it's re-validated and re-derived from here. */
  evidenceGuardResult: unknown;
}

export interface ResumeQADependencies {
  claudeClient: Anthropic;
}

function regroupIssuesBySeverity(issues: QAIssue[]) {
  return {
    criticalIssues: issues.filter((i) => i.severity === "CRITICAL"),
    highIssues: issues.filter((i) => i.severity === "HIGH"),
    mediumIssues: issues.filter((i) => i.severity === "MEDIUM"),
    lowIssues: issues.filter((i) => i.severity === "LOW")
  };
}

/**
 * Deterministic decision enforcement — see docs/AGENTS.md for the full
 * rationale. Claude's own `status` is respected as far as it can be, but
 * the hard constraints from the Phase 4 spec are never left to the model:
 *
 * 1. Any CRITICAL issue -> status is forced to FAIL, no exceptions.
 * 2. Any HIGH issue with no CRITICAL issue -> status may be FAIL or
 *    REVIEW_REQUIRED (Claude's judgment on how serious it is), but a
 *    reported PASS is downgraded to REVIEW_REQUIRED — a resume with a
 *    HIGH-severity issue is never silently approved.
 * 3. No CRITICAL/HIGH issues -> Claude's own status stands as-is.
 * 4. humanReviewRequired is always true unless status ends up PASS with
 *    zero CRITICAL/HIGH issues — "never automatically approve" (spec §14).
 */
function enforceDecisionRules(
  claudeStatus: ResumeQAReport["status"],
  criticalIssues: QAIssue[],
  highIssues: QAIssue[]
): { status: ResumeQAReport["status"]; humanReviewRequired: boolean } {
  let status: ResumeQAReport["status"];

  if (criticalIssues.length > 0) {
    status = "FAIL";
  } else if (highIssues.length > 0) {
    status = claudeStatus === "PASS" ? "REVIEW_REQUIRED" : claudeStatus;
  } else {
    status = claudeStatus;
  }

  const humanReviewRequired = status !== "PASS" || criticalIssues.length > 0 || highIssues.length > 0;

  return { status, humanReviewRequired };
}

/**
 * Phase 4: an independent review of an already-tailored resume that trusts
 * neither the Resume Tailoring Agent's output (Phase 3) nor the Evidence
 * Guard result (Phase 3.1) — both are re-examined against the real source
 * of truth (Master Resume + Career Profile) rather than assumed correct.
 * Never rewrites the resume; only reports findings for a human (or a future
 * Application Package phase, not built here) to act on.
 */
export async function reviewResume(input: ResumeQAInput, deps: ResumeQADependencies): Promise<ResumeQAReport> {
  const jobResult = JobSchema.safeParse(input.job);
  if (!jobResult.success) {
    throw new InvalidQAInputError("Invalid or missing job", formatZodIssues(jobResult.error));
  }
  const job = jobResult.data;

  if (!input.careerProfile || Object.keys(input.careerProfile).length === 0) {
    throw new InvalidQAInputError("Career profile is empty or unavailable");
  }

  if (!input.masterResume || input.masterResume.trim().length === 0) {
    throw new InvalidQAInputError("Master resume is empty or unavailable");
  }

  const tailoredResumeResult = TailoredResumeSchema.safeParse(input.tailoredResume);
  if (!tailoredResumeResult.success) {
    throw new InvalidQAInputError("Invalid or missing tailored resume", formatZodIssues(tailoredResumeResult.error));
  }
  const tailoredResume: TailoredResume = tailoredResumeResult.data;

  const evidenceGuardResultParsed = ResumeEvidenceReportSchema.safeParse(input.evidenceGuardResult);
  if (!evidenceGuardResultParsed.success) {
    throw new InvalidQAInputError(
      "Invalid or missing evidence guard result",
      formatZodIssues(evidenceGuardResultParsed.error)
    );
  }
  const evidenceGuardResult: ResumeEvidenceReport = evidenceGuardResultParsed.data;

  const rawReport = await reviewTailoredResume(
    job,
    input.careerProfile,
    input.masterResume,
    tailoredResume,
    evidenceGuardResult,
    { client: deps.claudeClient }
  );

  const allIssues = [...rawReport.criticalIssues, ...rawReport.highIssues, ...rawReport.mediumIssues, ...rawReport.lowIssues];
  const buckets = regroupIssuesBySeverity(allIssues);
  const { status, humanReviewRequired } = enforceDecisionRules(rawReport.status, buckets.criticalIssues, buckets.highIssues);

  return {
    ...rawReport,
    ...buckets,
    status,
    humanReviewRequired
  };
}
