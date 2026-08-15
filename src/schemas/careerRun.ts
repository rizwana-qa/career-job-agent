import { z } from "zod";

/**
 * dryRun defaults true and sendWhatsApp defaults false — the endpoint never
 * sends a notification, let alone submits anything, unless both are
 * explicitly overridden by the caller (Phase 8 spec §2-3).
 */
export const CareerRunOptionsSchema = z.object({
  maxJobs: z.number().int().positive().max(200).optional().default(20),
  topJobs: z.number().int().positive().max(50).optional().default(5),
  sendWhatsApp: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(true)
});

export type CareerRunOptions = z.infer<typeof CareerRunOptionsSchema>;

export const CareerRunStatusSchema = z.enum(["COMPLETED", "PARTIAL", "FAILED"]);
export type CareerRunStatus = z.infer<typeof CareerRunStatusSchema>;

/**
 * Safe summary only — no full job description, no resume, no career
 * profile. Enough for a human (or n8n) to know what was found and its
 * outcome.
 */
export const CareerRunTopJobSchema = z.object({
  role: z.string(),
  company: z.string(),
  sourceUrl: z.string(),
  matchScore: z.number().int().min(0).max(100),
  careerScore: z.number().int().min(0).max(100),
  classification: z.string(),
  applicationStatus: z.enum(["READY_FOR_REVIEW", "FAILED", "HUMAN_REVIEW_REQUIRED"])
});
export type CareerRunTopJob = z.infer<typeof CareerRunTopJobSchema>;

/**
 * Safe summary only — a count and a boolean flag, never the underlying
 * Claude error text or payload (toSafeErrorMessage() in utils/errors.ts can
 * still include the raw provider error body, e.g. a full Anthropic 400
 * response — that's fine for server-side logs but too much detail for an
 * API response). Lets n8n know Job Matching partially or fully failed
 * without exposing any error/prompt/profile/resume content.
 */
export const CareerRunMatchingFailuresSchema = z.object({
  count: z.number().int().min(0),
  hasFailures: z.boolean()
});
export type CareerRunMatchingFailures = z.infer<typeof CareerRunMatchingFailuresSchema>;

export const CareerRunResultSchema = z.object({
  runId: z.string(),
  status: CareerRunStatusSchema,
  jobsDiscovered: z.number().int().min(0),
  jobsAfterFiltering: z.number().int().min(0),
  jobsMatched: z.number().int().min(0),
  topJobs: z.array(CareerRunTopJobSchema),
  applicationPackagesCreated: z.number().int().min(0),
  whatsappNotificationsSent: z.number().int().min(0),
  matchingFailures: CareerRunMatchingFailuresSchema,
  dryRun: z.boolean(),
  startedAt: z.string(),
  completedAt: z.string()
});
export type CareerRunResult = z.infer<typeof CareerRunResultSchema>;
