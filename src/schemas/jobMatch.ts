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
  reason: z.string().trim().min(1),
  /**
   * Career Relevance Gate (Phase 8.3) — optional so every existing caller
   * and test fixture that predates this field (POST /career/run,
   * POST /jobs/analyze, and their tests) keeps validating and behaving
   * exactly as before. Only POST /career/discover-match's own gate logic
   * reads this field; matchScore's meaning and every other field are
   * unchanged. Distinct from matchScore: matchScore is "how well does this
   * job fit the candidate's own skills/experience", careerRelevanceScore is
   * "how strongly does this role belong to the candidate's target career
   * family at all" (e.g. a Tier III Service Desk Engineer role could in
   * principle score reasonably on matchScore-adjacent factors while still
   * being a fundamentally different career family — this field is what lets
   * the gate reject that independently of matchScore).
   */
  careerRelevanceScore: score().optional(),
  /** Short, safe, human-readable rationale for why a job was (or would be) shortlisted — never full job description or profile content. */
  whySelected: z.string().trim().min(1).optional()
});

export type JobMatch = z.infer<typeof JobMatchSchema>;

/**
 * matchScore is never a real ATS score. This label is generated in code, not by
 * Claude, so it can never be omitted or reworded away by a model response.
 */
export const MATCH_SCORE_LABEL = "Estimated Application Match Score";
