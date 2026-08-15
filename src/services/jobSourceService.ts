import { JobSchema, type Job, type JobValidationFailure } from "../schemas/job.js";
import { formatZodIssues } from "../utils/zod.js";

export interface JobSourceResult {
  validJobs: Job[];
  invalidJobs: JobValidationFailure[];
}

/**
 * Accepts a raw array of unknown job records (e.g. parsed from a JSON
 * payload) and validates each one individually against JobSchema, so a
 * single malformed record doesn't reject the whole batch. This is the only
 * supported job source for the MVP — no LinkedIn, no scraping, no external
 * job APIs.
 */
export function loadJobsFromInput(rawJobs: unknown[]): JobSourceResult {
  const validJobs: Job[] = [];
  const invalidJobs: JobValidationFailure[] = [];

  rawJobs.forEach((rawJob, index) => {
    const result = JobSchema.safeParse(rawJob);
    if (result.success) {
      validJobs.push(result.data);
    } else {
      invalidJobs.push({ index, errors: formatZodIssues(result.error) });
    }
  });

  return { validJobs, invalidJobs };
}
