import { z } from "zod";
import { EmploymentTypeSchema } from "./job.js";

/**
 * All fields are optional — callers rarely supply every dimension, and
 * jobDiscoveryService.ts merges this against profile-derived defaults
 * (from profile/job_preferences.md / career_profile.md) before a caller's
 * explicit value ever wins. Nothing here is a hardcoded personal preference.
 */
export const SearchCriteriaSchema = z.object({
  roleKeywords: z.array(z.string().trim().min(1)).optional(),
  locations: z.array(z.string().trim().min(1)).optional(),
  countries: z.array(z.string().trim().min(1)).optional(),
  remoteOnly: z.boolean().optional(),
  /** Never defaulted — see profile/job_preferences.md's Compensation Strategy for why. */
  minimumSalary: z.number().positive().optional(),
  employmentTypes: z.array(EmploymentTypeSchema).optional(),
  postedWithinDays: z.number().int().positive().optional(),
  /** Free text — the spec doesn't define a fixed taxonomy, and inventing one isn't warranted. */
  experienceLevel: z.string().trim().min(1).optional(),
  industries: z.array(z.string().trim().min(1)).optional(),
  excludedKeywords: z.array(z.string().trim().min(1)).optional()
});

export type SearchCriteria = z.infer<typeof SearchCriteriaSchema>;
