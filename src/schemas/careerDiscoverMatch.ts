import { z } from "zod";
import { JobSchema, RemoteStatusSchema, EmploymentTypeSchema } from "./job.js";
import { JobMatchSchema } from "./jobMatch.js";
import { CareerRunStatusSchema } from "./careerRun.js";

/** Per-source discovery diagnostic (Phase 8.4 §12) — safe, credential-free status only. */
export const SourceDiagnosticSchema = z.object({
  name: z.string(),
  status: z.enum(["OK", "FAILED"]),
  jobsFound: z.number().int().min(0).optional()
});
export type SourceDiagnostic = z.infer<typeof SourceDiagnosticSchema>;

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
  /** Phase 8.4 additions — always derivable from the underlying Job, additive/backward-compatible (jobTitle is kept, not renamed to "title", so existing n8n integrations reading jobTitle are unaffected). */
  country: z.string(),
  remoteStatus: RemoteStatusSchema,
  employmentType: EmploymentTypeSchema,
  salary: z.number().optional(),
  currency: z.string().optional(),
  /** Mirrors Job.datePosted directly (Phase 8.3.2 §3 — renamed from Phase 8.4's "postedAt" to match the underlying Job model's own field name exactly). */
  datePosted: z.string(),
  source: z.string(),
  sourceUrl: z.string(),
  /** Career Relevance Gate (Phase 8.3) — how strongly this role belongs to the target career family. Every job in topJobs has already passed the >= 70 gate; see careerRelevanceFilter.ts. */
  careerRelevanceScore: z.number().int().min(0).max(100),
  matchScore: z.number().int().min(0).max(100),
  interviewPotential: z.number().int().min(0).max(100),
  careerGrowth: z.number().int().min(0).max(100),
  futureAIValue: z.number().int().min(0).max(100),
  recommendation: z.string(),
  /** Short, safe rationale — never full job description or profile content. */
  whySelected: z.string(),
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
  /** Jobs Claude successfully evaluated (any recommendation, pre-gate) — NOT the shortlist count. See topJobs.length for how many actually qualified. */
  jobsMatched: z.number().int().min(0),
  matchingFailures: z.number().int().min(0),
  /** Career Relevance Gate (Phase 8.3) — jobs whose TITLE was a hard negative (help desk/service desk/IT support/sysadmin/NOC/etc.) and were never sent to Claude at all. */
  relevanceFiltered: z.number().int().min(0),
  /** Only jobs that passed the full Career Relevance Gate: careerRelevanceScore >= 70 AND matchScore >= 70 AND recommendation in {APPLY, CONSIDER}. A REJECT recommendation never appears here. */
  topJobs: z.array(DiscoverMatchTopJobSchema),
  /** Per-source discovery diagnostics (Phase 8.4 §12) — one source failing never fails the whole run; see SourceDiagnosticSchema. */
  sources: z.array(SourceDiagnosticSchema)
});
export type DiscoverMatchResult = z.infer<typeof DiscoverMatchResultSchema>;
