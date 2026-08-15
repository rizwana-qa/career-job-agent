import { z } from "zod";

/**
 * Every claim Claude makes about fit must be labeled with how well-founded it is.
 * FACT = directly supported by the career profile. INFERENCE = a plausible transfer,
 * not a stated fact. UNKNOWN = the profile doesn't establish this either way.
 * This is enforced structurally so "inference" can never silently read as "fact".
 */
export const EvidenceLevelSchema = z.enum(["FACT", "INFERENCE", "UNKNOWN"]);
export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>;

export const EvidenceStatementSchema = z.object({
  statement: z.string().trim().min(1),
  evidence: EvidenceLevelSchema
});
export type EvidenceStatement = z.infer<typeof EvidenceStatementSchema>;

export const RecommendationSchema = z.enum(["APPLY", "CONSIDER", "REJECT"]);
export type Recommendation = z.infer<typeof RecommendationSchema>;

const score = () => z.number().int().min(0).max(100);

export const JobMatchSchema = z.object({
  matchScore: score(),
  interviewPotential: score(),
  careerGrowth: score(),
  futureAIValue: score(),
  recommendation: RecommendationSchema,
  strongMatches: z.array(EvidenceStatementSchema),
  transferableSkills: z.array(EvidenceStatementSchema),
  gaps: z.array(EvidenceStatementSchema),
  risks: z.array(EvidenceStatementSchema),
  reason: z.string().trim().min(1)
});

export type JobMatch = z.infer<typeof JobMatchSchema>;

/**
 * matchScore is never a real ATS score. This label is generated in code, not by
 * Claude, so it can never be omitted or reworded away by a model response.
 */
export const MATCH_SCORE_LABEL = "Estimated Application Match Score";
