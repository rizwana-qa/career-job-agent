import { z } from "zod";
import { RemoteStatusSchema } from "./job.js";
import { EvidenceStatementSchema } from "./jobMatch.js";
import { TailoredResumeSchema } from "./tailoredResume.js";
import { QAStatusSchema } from "./resumeQA.js";

/** Response Claude must return for the application message step. */
export const ApplicationMessageResponseSchema = z.object({
  applicationMessage: z.string().trim().min(1)
});

/** Job facts relevant to a human deciding whether to apply — never the full JD text. */
export const ApplicationJobInfoSchema = z.object({
  jobTitle: z.string(),
  company: z.string(),
  location: z.string(),
  country: z.string(),
  remoteStatus: RemoteStatusSchema,
  sourceUrl: z.string(),
  /** The job posting's own disclosed salary, or "UNKNOWN" — never an invented figure (same convention as jobAnalysisService.ts). */
  salary: z.union([z.number(), z.literal("UNKNOWN")]),
  currency: z.union([z.string(), z.literal("UNKNOWN")])
});

const score = () => z.number().int().min(0).max(100);

export const JobMatchSummarySchema = z.object({
  matchScore: score(),
  matchScoreLabel: z.string(),
  interviewPotential: score(),
  /** Phase 2's JobMatch.careerGrowth — "career value" in the Phase 5 spec's wording. */
  careerGrowth: score(),
  strongMatches: z.array(EvidenceStatementSchema),
  transferableSkills: z.array(EvidenceStatementSchema),
  gaps: z.array(EvidenceStatementSchema)
});

/** The full tailored resume plus the deterministic version identifier assigned to this package. */
export const ApplicationResumeSchema = TailoredResumeSchema.extend({
  resumeVersion: z.string().trim().min(1)
});

export const ResumeQASummarySchema = z.object({
  status: QAStatusSchema,
  jdAlignmentScore: score(),
  factualAccuracyScore: score(),
  interviewReadinessScore: score(),
  /** Maps from ResumeQAReport.supportedKeywords. */
  importantKeywords: z.array(z.string()),
  /** Maps from ResumeQAReport.missingImportantKeywords. */
  missingKeywords: z.array(z.string())
});

/**
 * The success-path output (Resume QA status was PASS). applicationStatus is
 * a hardcoded literal, not a general enum — this is a schema-level guarantee
 * that this codebase can never produce "APPLIED"; only a future, explicitly
 * human-triggered action could ever introduce that value (see Phase 5 spec §5).
 */
export const ApplicationPackageSchema = z.object({
  applicationId: z.string().trim().min(1),
  status: z.literal("READY_FOR_REVIEW"),

  jobId: z.string().trim().min(1),
  company: z.string(),
  role: z.string(),
  source: z.string(),
  sourceUrl: z.string(),
  matchScore: score(),
  resumeVersion: z.string().trim().min(1),
  qaStatus: z.literal("PASS"),
  applicationStatus: z.literal("READY_FOR_REVIEW"),

  job: ApplicationJobInfoSchema,
  jobMatch: JobMatchSummarySchema,
  resume: ApplicationResumeSchema,
  resumeQA: ResumeQASummarySchema,

  applicationMessage: z.string().trim().min(1),
  /** Deterministic check (not Claude): any JD-listed skill in the message that isn't traceable to source material. Empty in the common case. */
  applicationMessageUnsupportedClaims: z.array(z.string()),

  createdAt: z.string().trim().min(1)
});

export type ApplicationPackage = z.infer<typeof ApplicationPackageSchema>;

/** Returned (never thrown) when Resume QA status was REVIEW_REQUIRED — a package is deliberately NOT generated. */
export const ApplicationPackageReviewRequiredResultSchema = z.object({
  status: z.literal("HUMAN_REVIEW_REQUIRED"),
  jobId: z.string(),
  qaStatus: z.literal("REVIEW_REQUIRED"),
  reason: z.string()
});
export type ApplicationPackageReviewRequiredResult = z.infer<typeof ApplicationPackageReviewRequiredResultSchema>;

/** Returned (never thrown) when Resume QA status was FAIL — the pipeline stops here. */
export const ApplicationPackageFailedResultSchema = z.object({
  status: z.literal("FAILED"),
  jobId: z.string(),
  qaStatus: z.literal("FAIL"),
  reason: z.string(),
  criticalIssueSummaries: z.array(z.string())
});
export type ApplicationPackageFailedResult = z.infer<typeof ApplicationPackageFailedResultSchema>;

export type ApplicationPackageResult =
  | ApplicationPackage
  | ApplicationPackageReviewRequiredResult
  | ApplicationPackageFailedResult;
