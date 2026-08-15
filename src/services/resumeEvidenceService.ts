import type Anthropic from "@anthropic-ai/sdk";
import { TailoredResumeSchema, type TailoredResume } from "../schemas/tailoredResume.js";
import { type EvidenceClaim, type ResumeEvidenceReport } from "../schemas/resumeEvidence.js";
import { verifyResumeEvidence } from "../agents/resumeEvidenceAgent.js";
import type { ResumeRelevantProfileFields } from "./profileService.js";
import { InvalidEvidenceInputError } from "../utils/errors.js";
import { formatZodIssues } from "../utils/zod.js";

export interface VerifyResumeEvidenceInput {
  masterResume: string;
  careerProfile: ResumeRelevantProfileFields;
  /** Unvalidated — this service re-validates it against TailoredResumeSchema, since it's the actual trust boundary. */
  tailoredResume: unknown;
}

export interface VerifyResumeEvidenceDependencies {
  claudeClient: Anthropic;
}

function collectAllClaims(report: ResumeEvidenceReport): EvidenceClaim[] {
  return [
    ...report.supportedClaims,
    ...report.transferableClaims,
    ...report.potentiallyUnsupportedClaims,
    ...report.unsupportedClaims,
    ...report.unknownClaims
  ];
}

/**
 * Re-derives the five claim buckets from each claim's own `classification`
 * field, rather than trusting which array Claude physically put it in —
 * protects against the model bucketing a claim inconsistently with its own
 * stated classification.
 */
function regroupByClassification(claims: EvidenceClaim[]) {
  return {
    supportedClaims: claims.filter((c) => c.classification === "SUPPORTED"),
    transferableClaims: claims.filter((c) => c.classification === "TRANSFERABLE"),
    potentiallyUnsupportedClaims: claims.filter((c) => c.classification === "POTENTIALLY_UNSUPPORTED"),
    unsupportedClaims: claims.filter((c) => c.classification === "UNSUPPORTED"),
    unknownClaims: claims.filter((c) => c.classification === "UNKNOWN")
  };
}

/**
 * Phase 3.1: an independent, Claude-based audit of the free-text portions of
 * an already-tailored resume (professionalSummary, experience bullets,
 * tailoredResume) that Phase 3's deterministic checks don't cover. This
 * agent never rewrites anything — it only extracts and classifies claims for
 * a future Resume QA phase (not built here) to act on.
 *
 * status, evidenceScore, and claimsReviewed are always recomputed here from
 * the classified claims, deterministically, never trusted verbatim from
 * Claude — the same pattern used throughout Phases 2 and 3.
 */
export async function verifyResumeEvidenceReport(
  input: VerifyResumeEvidenceInput,
  deps: VerifyResumeEvidenceDependencies
): Promise<ResumeEvidenceReport> {
  if (!input.masterResume || input.masterResume.trim().length === 0) {
    throw new InvalidEvidenceInputError("Master resume is empty or unavailable");
  }

  if (!input.careerProfile || Object.keys(input.careerProfile).length === 0) {
    throw new InvalidEvidenceInputError("Career profile is empty or unavailable");
  }

  const tailoredResumeResult = TailoredResumeSchema.safeParse(input.tailoredResume);
  if (!tailoredResumeResult.success) {
    throw new InvalidEvidenceInputError("Invalid or missing tailored resume", formatZodIssues(tailoredResumeResult.error));
  }
  const tailoredResume: TailoredResume = tailoredResumeResult.data;

  const rawReport = await verifyResumeEvidence(input.masterResume, input.careerProfile, tailoredResume, {
    client: deps.claudeClient
  });

  const allClaims = collectAllClaims(rawReport);
  const buckets = regroupByClassification(allClaims);

  const claimsReviewed = allClaims.length;
  const evidenceScore =
    claimsReviewed === 0 ? 100 : Math.round((buckets.supportedClaims.length / claimsReviewed) * 100);
  const status = buckets.unsupportedClaims.length > 0 || buckets.potentiallyUnsupportedClaims.length > 0
    ? "REVIEW_REQUIRED"
    : "PASS";

  return {
    status,
    evidenceScore,
    claimsReviewed,
    ...buckets,
    recommendations: rawReport.recommendations
  };
}
