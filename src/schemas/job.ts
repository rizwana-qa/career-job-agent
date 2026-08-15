import { z } from "zod";
import { formatZodIssues } from "../utils/zod.js";

export const RemoteStatusSchema = z.enum(["REMOTE", "HYBRID", "ONSITE"]);
export type RemoteStatus = z.infer<typeof RemoteStatusSchema>;

export const EmploymentTypeSchema = z.enum([
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "FREELANCE",
  "INTERNSHIP"
]);
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>;

export const JobSchema = z.object({
  jobTitle: z.string().trim().min(1, "jobTitle is required"),
  company: z.string().trim().min(1, "company is required"),
  location: z.string().trim().min(1, "location is required"),
  country: z.string().trim().min(1, "country is required"),
  remoteStatus: RemoteStatusSchema,
  employmentType: EmploymentTypeSchema,
  jobDescription: z.string().trim().min(20, "jobDescription must be at least 20 characters"),
  requirements: z.array(z.string().trim().min(1)).min(1, "requirements must have at least one entry"),
  responsibilities: z.array(z.string().trim().min(1)).min(1, "responsibilities must have at least one entry"),
  skills: z.array(z.string().trim().min(1)).min(1, "skills must have at least one entry"),
  source: z.string().trim().min(1, "source is required"),
  sourceUrl: z.string().trim().url("sourceUrl must be a valid URL"),
  datePosted: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "datePosted must be an ISO date string (YYYY-MM-DD)"),
  salary: z.number().positive("salary must be a positive number").optional(),
  currency: z.string().trim().length(3, "currency must be a 3-letter ISO code").optional(),
  externalJobId: z.string().trim().min(1).optional(),
  /** ISO date string (YYYY-MM-DD) — when our own pipeline first discovered this posting, distinct from datePosted (the provider's own posting date). Optional/additive (Phase 8.4); omitted entirely by sources that don't set it. */
  discoveredAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "discoveredAt must be an ISO date string (YYYY-MM-DD)")
    .optional(),
  /**
   * Cross-source deduplication (Phase 8.4 §8): when the same role is found
   * on more than one job source, deduplicateAcrossSources() keeps one Job as
   * canonical (sourceUrl unchanged) and records every other source's URL
   * here — internal bookkeeping only, never surfaced as a public API field.
   */
  alternateSourceUrls: z.array(z.string().trim().url()).optional()
});

export type Job = z.infer<typeof JobSchema>;

export interface JobValidationFailure {
  index: number;
  errors: string[];
}

export const formatJobValidationErrors = formatZodIssues;
