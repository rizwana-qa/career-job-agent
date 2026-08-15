import { z } from "zod";

export const ClaimClassificationSchema = z.enum([
  "SUPPORTED",
  "TRANSFERABLE",
  "POTENTIALLY_UNSUPPORTED",
  "UNSUPPORTED",
  "UNKNOWN"
]);
export type ClaimClassification = z.infer<typeof ClaimClassificationSchema>;

export const EvidenceClaimSchema = z.object({
  /** The claim, extracted verbatim or near-verbatim from the tailored resume text. */
  claim: z.string().trim().min(1),
  /** Where it came from: "professionalSummary", "experience[<n>].bullets[<n>]", or "tailoredResume". */
  sourceLocation: z.string().trim().min(1),
  /** What in the Master Resume / Career Profile supports or fails to support it — never left blank, even for UNSUPPORTED. */
  evidence: z.string().trim().min(1),
  classification: ClaimClassificationSchema
});
export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>;

export const EvidenceStatusSchema = z.enum(["PASS", "REVIEW_REQUIRED"]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

/**
 * Validates the SHAPE Claude must return. status/evidenceScore/claimsReviewed
 * are always recomputed deterministically by resumeEvidenceService.ts from
 * the classified claims afterward — never trusted verbatim from the model —
 * so this schema is a structural contract, not the final authoritative report.
 */
export const ResumeEvidenceReportSchema = z.object({
  status: EvidenceStatusSchema,
  evidenceScore: z.number().int().min(0).max(100),
  claimsReviewed: z.number().int().min(0),
  supportedClaims: z.array(EvidenceClaimSchema),
  transferableClaims: z.array(EvidenceClaimSchema),
  potentiallyUnsupportedClaims: z.array(EvidenceClaimSchema),
  unsupportedClaims: z.array(EvidenceClaimSchema),
  unknownClaims: z.array(EvidenceClaimSchema),
  recommendations: z.array(z.string().trim().min(1))
});

export type ResumeEvidenceReport = z.infer<typeof ResumeEvidenceReportSchema>;
