import { z } from "zod";
import { JobSchema } from "./job.js";
import { JobMatchSchema } from "./jobMatch.js";
import { CareerRunStatusSchema } from "./careerRun.js";

/**
 * POST /career/process-job request — Phase 8.2. `jobData` is the same
 * `{ job, match }` payload POST /career/discover-match returned for this
 * job (see careerDiscoverMatch.ts for why it must be round-tripped rather
 * than looked up server-side by jobId alone). `jobId` is kept as an
 * explicit field — not strictly required to run the pipeline, but useful
 * for request logging/tracing and cross-checked against jobData.job below
 * to catch a caller accidentally sending mismatched data.
 */
export const ProcessJobRequestSchema = z.object({
  jobId: z.string().trim().min(1),
  resumeProcessing: z.boolean(),
  jobData: z.object({
    job: JobSchema,
    match: JobMatchSchema
  })
});
export type ProcessJobRequest = z.infer<typeof ProcessJobRequestSchema>;

/**
 * resumeQAStatus is a plain string here (not QAStatusSchema's strict
 * PASS/FAIL/REVIEW_REQUIRED enum) because it must also represent "the QA
 * stage never ran" when an earlier stage (tailoring/evidence) throws —
 * "NOT_REACHED" in that case, one of the real QAStatus values otherwise.
 */
export const ProcessJobResultSchema = z.object({
  status: CareerRunStatusSchema,
  jobId: z.string(),
  company: z.string(),
  jobTitle: z.string(),
  resumeQAStatus: z.string(),
  resumeQAOverallScore: z.number().int().min(0).max(100),
  applicationPackageCreated: z.boolean()
});
export type ProcessJobResult = z.infer<typeof ProcessJobResultSchema>;
