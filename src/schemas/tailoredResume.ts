import { z } from "zod";

/**
 * Mirrors the Job Matching Agent's evidence model (see schemas/jobMatch.ts):
 * every requirement mapping must say how strong the evidence actually is.
 * TRANSFERABLE must never be reported as DIRECT_MATCH; GAP must never be
 * reworded into a claimed qualification.
 */
export const MatchTypeSchema = z.enum(["DIRECT_MATCH", "TRANSFERABLE", "PARTIAL_MATCH", "GAP", "UNKNOWN"]);
export type MatchType = z.infer<typeof MatchTypeSchema>;

export const RequirementMappingSchema = z.object({
  requirement: z.string().trim().min(1),
  evidence: z.string().trim().min(1),
  matchType: MatchTypeSchema
});
export type RequirementMapping = z.infer<typeof RequirementMappingSchema>;

export const ExperienceEntrySchema = z.object({
  title: z.string().trim().min(1),
  company: z.string().trim().min(1),
  dates: z.string().trim().min(1),
  bullets: z.array(z.string().trim().min(1)).min(1)
});
export type ExperienceEntry = z.infer<typeof ExperienceEntrySchema>;

export const TAILORED_RESUME_STATUS = "READY_FOR_RESUME_QA" as const;

/**
 * jobId/targetRole/targetCompany/status are echoed by Claude for prompt
 * clarity, but the service layer (resumeTailoringService.ts) always
 * overwrites them from the actual validated Job object and the fixed status
 * constant before returning — never trusted from the model alone, the same
 * pattern used for MATCH_SCORE_LABEL in schemas/jobMatch.ts.
 */
export const TailoredResumeSchema = z.object({
  jobId: z.string().trim().min(1),
  targetRole: z.string().trim().min(1),
  targetCompany: z.string().trim().min(1),

  professionalSummary: z.string().trim().min(1),
  coreSkills: z.array(z.string().trim().min(1)),
  experience: z.array(ExperienceEntrySchema),
  education: z.array(z.string().trim().min(1)),
  certifications: z.array(z.string().trim().min(1)),

  matchedRequirements: z.array(RequirementMappingSchema),
  transferableRequirements: z.array(RequirementMappingSchema),
  gaps: z.array(RequirementMappingSchema),

  keywordsAdded: z.array(z.string().trim().min(1)),
  changesMade: z.array(z.string().trim().min(1)),
  claimsRequiringVerification: z.array(z.string().trim().min(1)),

  tailoredResume: z.string().trim().min(1),
  status: z.string().trim().min(1)
});

export type TailoredResume = z.infer<typeof TailoredResumeSchema>;
