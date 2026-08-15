import type { Job } from "../schemas/job.js";

/**
 * Discovery-specific dedup key, distinct from jobFilterService.ts's
 * deduplicateJobs() (Phase 2, still used unchanged for the manual-JSON-input
 * path). Where externalJobId exists it's preferred, namespaced by source
 * (provider IDs are only unique within a given provider, not globally).
 * Otherwise falls back to a deterministic composite of company + job title +
 * location + source, exactly as specified for Phase 6.
 */
function discoveryDedupeKey(job: Job): string {
  const source = job.source.trim().toLowerCase();

  if (job.externalJobId && job.externalJobId.trim().length > 0) {
    return `id:${source}:${job.externalJobId.trim().toLowerCase()}`;
  }

  return [
    "composite",
    job.company.trim().toLowerCase(),
    job.jobTitle.trim().toLowerCase(),
    job.location.trim().toLowerCase(),
    source
  ].join("|");
}

/** Deterministic only — no Claude involvement, per Phase 6 spec §7. */
export function deduplicateDiscoveredJobs(jobs: Job[]): Job[] {
  const seen = new Set<string>();
  const result: Job[] = [];

  for (const job of jobs) {
    const key = discoveryDedupeKey(job);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(job);
    }
  }

  return result;
}
