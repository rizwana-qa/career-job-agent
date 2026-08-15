import { z } from "zod";
import { JobSchema } from "./job.js";
import { JobMatchSchema } from "./jobMatch.js";
import { CareerRunStatusSchema } from "./careerRun.js";

/**
 * POST /career/discover-match request — Phase 8.2. Same validation limits
 * as CareerRunOptionsSchema's maxJobs/topJobs (Phase 8 spec §2-3), reused
 * for consistency rather than inventing new bounds.
 */
export const DiscoverMatchRequestSchema = z.object({
  maxJobs: z.number().int().positive().max(200).optional().default(10),
  topJobs: z.number().int().positive().max(50).optional().default(5)
});
export type DiscoverMatchRequest = z.infer<typeof DiscoverMatchRequestSchema>;

/**
 * `jobData` is a deliberate, documented addition beyond the minimal summary
 * fields — see docs/N8N_INTEGRATION.md "Why jobData exists". Phase 8.1
 * established that no persistent/shared store exists (and none is being
 * added here), so POST /career/process-job cannot reliably look a job back
 * up by ID alone across separate requests/instances. The caller (n8n) is
 * expected to round-trip this field, unmodified, into /career/process-job's
 * request body for the jobs it chooses to process further. It carries the
 * already-public job posting plus the already-computed match — never resume,
 * career profile, or prompt content.
 */
export const DiscoverMatchTopJobSchema = z.object({
  jobId: z.string().trim().min(1),
  jobTitle: z.string(),
  company: z.string(),
  location: z.string(),
  source: z.string(),
  sourceUrl: z.string(),
  matchScore: z.number().int().min(0).max(100),
  interviewPotential: z.number().int().min(0).max(100),
  careerGrowth: z.number().int().min(0).max(100),
  futureAIValue: z.number().int().min(0).max(100),
  recommendation: z.string(),
  jobData: z.object({
    job: JobSchema,
    match: JobMatchSchema
  })
});
export type DiscoverMatchTopJob = z.infer<typeof DiscoverMatchTopJobSchema>;

export const DiscoverMatchResultSchema = z.object({
  status: CareerRunStatusSchema,
  jobsDiscovered: z.number().int().min(0),
  jobsAfterFiltering: z.number().int().min(0),
  jobsMatched: z.number().int().min(0),
  matchingFailures: z.number().int().min(0),
  topJobs: z.array(DiscoverMatchTopJobSchema)
});
export type DiscoverMatchResult = z.infer<typeof DiscoverMatchResultSchema>;
