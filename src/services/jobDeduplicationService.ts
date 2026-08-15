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

/** Cross-source fallback key (Phase 8.4 §8) — normalized company + title only, deliberately excluding source/location/URL so the SAME role posted on two different boards collides. Only ever used to merge jobs from DIFFERENT sources (see deduplicateAcrossSources) — never applied within a single source, where two postings sharing a company+title may legitimately be distinct roles. */
function crossSourceFallbackKey(job: Job): string {
  return [job.company.trim().toLowerCase(), job.jobTitle.trim().toLowerCase()].join("|");
}

export interface CrossSourceDeduplicationResult {
  deduplicated: Job[];
  duplicatesRemoved: number;
}

/**
 * Multi-source deduplication (Phase 8.4 §8), used only by
 * POST /career/discover-match's multi-source path — /career/run and
 * /jobs/discover keep using deduplicateDiscoveredJobs() above, unchanged.
 *
 * Two passes:
 * 1. Exact same-source dedup, reusing deduplicateDiscoveredJobs() as-is (no
 *    logic duplicated).
 * 2. Cross-source merge: jobs from DIFFERENT sources sharing the same
 *    normalized company+title are collapsed into one opportunity. The
 *    first-seen job (by input order) is kept as the canonical, "most
 *    direct" application URL — a simple, deterministic tie-break, not a
 *    judgment about which board is more authoritative. Every other source's
 *    URL is preserved internally on Job.alternateSourceUrls (see
 *    schemas/job.ts) rather than discarded.
 */
export function deduplicateAcrossSources(jobs: Job[]): CrossSourceDeduplicationResult {
  const afterExactDedup = deduplicateDiscoveredJobs(jobs);

  const groups = new Map<string, Job[]>();
  for (const job of afterExactDedup) {
    const key = crossSourceFallbackKey(job);
    const group = groups.get(key);
    if (group) {
      group.push(job);
    } else {
      groups.set(key, [job]);
    }
  }

  const deduplicated: Job[] = [];
  let duplicatesRemoved = 0;

  for (const group of groups.values()) {
    const distinctSources = new Set(group.map((job) => job.source.trim().toLowerCase()));
    if (group.length === 1 || distinctSources.size === 1) {
      // Either a single job, or multiple jobs from the SAME source sharing a
      // company+title — not a cross-source duplicate; keep every one.
      deduplicated.push(...group);
      continue;
    }

    const [canonical, ...rest] = group;
    const alternateSourceUrls = Array.from(
      new Set(rest.map((job) => job.sourceUrl.trim()).filter((url) => url.length > 0 && url !== canonical.sourceUrl.trim()))
    );
    deduplicated.push(alternateSourceUrls.length > 0 ? { ...canonical, alternateSourceUrls } : canonical);
    duplicatesRemoved += rest.length;
  }

  return { deduplicated, duplicatesRemoved };
}
