import type { SearchCriteria } from "../schemas/searchCriteria.js";

/**
 * Raw, provider-shaped job data exactly as the source returns it — before
 * any normalization. Deliberately loose (not the Job schema) since every
 * provider's native shape is different; `normalize()` is what maps it
 * toward `src/schemas/job.ts`'s Job shape (still unknown/unvalidated at
 * that point — the caller validates via JobSchema, the real trust boundary).
 */
export type RawProviderJob = Record<string, unknown>;

/**
 * The provider abstraction Phase 6 is built against. Nothing in
 * src/services/jobDiscoveryService.ts is coupled to a specific provider —
 * it only knows this interface. Adding a second provider later means
 * implementing this interface again, not touching the discovery service.
 */
export interface JobSource {
  /** Machine-readable identifier, used as Job.source and in error/log messages. */
  readonly name: string;

  /** Performs one search against the provider. Implementations are responsible for respecting the provider's own rate-limit guidance (see docs/AGENTS.md → Job Discovery). */
  searchJobs(criteria: SearchCriteria): Promise<RawProviderJob[]>;

  /**
   * Looks up a single job by the provider's own ID. Not every provider
   * exposes a live per-job lookup endpoint — see remotiveJobSource.ts for
   * how it's implemented (or approximated) there. Returns null if not found.
   */
  getJob(jobId: string): Promise<RawProviderJob | null>;

  /**
   * Maps one raw provider job toward the shape of `src/schemas/job.ts`'s
   * JobSchema. Returns null when a required field can't be honestly derived
   * (e.g. an unrecognized employment-type value) — normalization never
   * invents a value it can't support from the source data.
   */
  normalize(raw: RawProviderJob): unknown;
}
