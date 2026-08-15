import { z } from "zod";
import { RequirementMappingSchema } from "./tailoredResume.js";
import { EvidenceClaimSchema } from "./resumeEvidence.js";

export const IssueSeveritySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;

/**
 * `severity` is carried on the issue itself (not just implied by which
 * bucket array it's in), the same defensive pattern used for claims in
 * schemas/resumeEvidence.ts — resumeQAService.ts re-buckets by this field
 * rather than trusting array placement.
 */
export const QAIssueSchema = z.object({
  severity: IssueSeveritySchema,
  /** Which QA dimension this relates to, e.g. "Factual Accuracy", "ATS Readability", "Seniority Alignment". */
  dimension: z.string().trim().min(1),
  description: z.string().trim().min(1),
  /** What in the source material (or its absence) grounds this finding. */
  evidence: z.string().trim().min(1)
});
export type QAIssue = z.infer<typeof QAIssueSchema>;

export const QAStatusSchema = z.enum(["PASS", "FAIL", "REVIEW_REQUIRED"]);
export type QAStatus = z.infer<typeof QAStatusSchema>;

const score = () => z.number().int().min(0).max(100);

/**
 * Validates the SHAPE Claude must return. status and humanReviewRequired are
 * always recomputed/enforced deterministically by resumeQAService.ts from
 * the issue buckets afterward — see docs/AGENTS.md for the exact rule —
 * never trusted verbatim, the same pattern used throughout Phases 2-3.1.
 */
export const ResumeQAReportSchema = z.object({
  status: QAStatusSchema,

  overallScore: score(),
  jdAlignmentScore: score(),
  factualAccuracyScore: score(),
  interviewReadinessScore: score(),

  criticalIssues: z.array(QAIssueSchema),
  highIssues: z.array(QAIssueSchema),
  mediumIssues: z.array(QAIssueSchema),
  lowIssues: z.array(QAIssueSchema),

  strengths: z.array(z.string().trim().min(1)),

  mandatoryRequirements: z.array(RequirementMappingSchema),
  preferredRequirements: z.array(RequirementMappingSchema),

  supportedKeywords: z.array(z.string().trim().min(1)),
  missingImportantKeywords: z.array(z.string().trim().min(1)),
  unsupportedKeywords: z.array(z.string().trim().min(1)),
  overusedKeywords: z.array(z.string().trim().min(1)),

  unsupportedClaims: z.array(EvidenceClaimSchema),
  transferableClaims: z.array(EvidenceClaimSchema),

  recommendations: z.array(z.string().trim().min(1)),

  humanReviewRequired: z.boolean()
});

export type ResumeQAReport = z.infer<typeof ResumeQAReportSchema>;

/** Code-owned label — never call this metric an "ATS Score" (see CLAUDE.md rule 6 and Phase 4 spec §6). */
export const JD_ALIGNMENT_SCORE_LABEL = "JD Alignment Score";
