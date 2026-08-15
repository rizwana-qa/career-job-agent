import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { CareerRunOptionsSchema, type CareerRunOptions, type CareerRunResult, type CareerRunStatus, type CareerRunTopJob } from "../schemas/careerRun.js";
import type { JobSource } from "../jobSources/jobSource.js";
import type { NotificationProvider } from "../notifications/notificationProvider.js";
import { discoverJobs } from "./jobDiscoveryService.js";
import { tailorResumeForJob } from "./resumeTailoringService.js";
import { verifyResumeEvidenceReport } from "./resumeEvidenceService.js";
import { reviewResume } from "./resumeQAService.js";
import { generateApplicationPackage } from "./applicationPackageService.js";
import { notifyTopOpportunities } from "../notifications/notificationService.js";
import {
  loadCareerProfile,
  loadCareerProfileForResumeTailoring,
  loadJobDiscoveryPreferences,
  loadMasterResume,
  loadResumeRelevantJobPreferences,
  type JobDiscoveryPreferences,
  type RelevantProfileFields,
  type ResumeRelevantJobPreferences,
  type ResumeRelevantProfileFields
} from "./profileService.js";
import type { ApplicationPackageResult } from "../schemas/applicationPackage.js";
import type { RankedJob } from "../ranking/jobRanking.js";
import { InvalidOrchestrationInputError, toSafeErrorMessage } from "../utils/errors.js";
import { formatZodIssues } from "../utils/zod.js";

// --- Idempotency: simple in-memory store, no database (Phase 8 spec §7) ---

export interface IdempotencyStore {
  get(key: string): CareerRunResult | undefined;
  set(key: string, result: CareerRunResult): void;
}

const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, { result: CareerRunResult; expiresAt: number }>();

  constructor(private readonly ttlMs: number = DEFAULT_IDEMPOTENCY_TTL_MS) {}

  get(key: string): CareerRunResult | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.result;
  }

  set(key: string, result: CareerRunResult): void {
    this.store.set(key, { result, expiresAt: Date.now() + this.ttlMs });
  }
}

// --- Orchestration ---

export interface CareerRunInput {
  /** Unvalidated caller input — re-validated via CareerRunOptionsSchema. */
  options?: unknown;
  /** From the Idempotency-Key request header, if provided. */
  idempotencyKey?: string;
}

export interface CareerRunDependencies {
  jobSource: JobSource;
  claudeClient?: Anthropic;
  notificationProvider?: NotificationProvider;
  matchingProfile?: RelevantProfileFields;
  resumeProfile?: ResumeRelevantProfileFields;
  masterResume?: string;
  jobDiscoveryPreferences?: JobDiscoveryPreferences;
  jobPreferences?: ResumeRelevantJobPreferences;
  idempotencyStore?: IdempotencyStore;
  /** Safe, structured operational logger — see Phase 8 spec §11. Defaults to a no-op. */
  log?: (event: Record<string, unknown>) => void;
}

function noopLog(): void {
  // no-op default — callers (the route) inject a real logger
}

function toTopJobSummary(ranked: RankedJob, applicationStatus: CareerRunTopJob["applicationStatus"]): CareerRunTopJob {
  return {
    role: ranked.job.jobTitle,
    company: ranked.job.company,
    sourceUrl: ranked.job.sourceUrl,
    matchScore: ranked.match.matchScore,
    careerScore: ranked.careerScore,
    classification: ranked.classification,
    applicationStatus
  };
}

function determineStatus(
  jobsDiscovered: number,
  packageResults: ApplicationPackageResult[],
  hadPerJobFailures: boolean,
  whatsappFailed: boolean
): CareerRunStatus {
  if (jobsDiscovered === 0) {
    return "COMPLETED"; // legitimately nothing to process — not a failure
  }
  if (packageResults.length === 0 && hadPerJobFailures) {
    return "FAILED";
  }
  if (hadPerJobFailures || whatsappFailed) {
    return "PARTIAL";
  }
  return "COMPLETED";
}

/**
 * Phase 8: the single orchestration entry point n8n calls. Reuses every
 * existing service as-is — Job Discovery (Phase 6), Resume Tailoring
 * (Phase 3), Evidence Guard (Phase 3.1), Resume QA (Phase 4), Application
 * Package (Phase 5), WhatsApp (Phase 7) — nothing here reimplements any of
 * their logic. A failure processing one job (or the optional WhatsApp send)
 * never aborts the whole run; it's recorded and the run continues, with the
 * final `status` reflecting COMPLETED / PARTIAL / FAILED accordingly.
 */
export async function runCareerPipeline(input: CareerRunInput, deps: CareerRunDependencies): Promise<CareerRunResult> {
  const log = deps.log ?? noopLog;

  const optionsResult = CareerRunOptionsSchema.safeParse(input.options ?? {});
  if (!optionsResult.success) {
    throw new InvalidOrchestrationInputError("Invalid run options", formatZodIssues(optionsResult.error));
  }
  const options: CareerRunOptions = optionsResult.data;

  if (input.idempotencyKey) {
    const store = deps.idempotencyStore;
    const cached = store?.get(input.idempotencyKey);
    if (cached) {
      log({ stage: "idempotency", event: "cache_hit", idempotencyKey: input.idempotencyKey });
      return cached;
    }
  }

  const runId = randomUUID();
  const startedAt = new Date();
  log({ runId, stage: "start", dryRun: options.dryRun, sendWhatsApp: options.sendWhatsApp, maxJobs: options.maxJobs, topJobs: options.topJobs });

  const matchingProfile = deps.matchingProfile ?? loadCareerProfile();
  const resumeProfile = deps.resumeProfile ?? loadCareerProfileForResumeTailoring();
  const masterResume = deps.masterResume ?? loadMasterResume();
  const jobDiscoveryPreferences = deps.jobDiscoveryPreferences ?? loadJobDiscoveryPreferences();
  const jobPreferences = deps.jobPreferences ?? loadResumeRelevantJobPreferences();

  let jobsDiscovered = 0;
  let jobsAfterFiltering = 0;
  let jobsMatched = 0;
  let rankedJobs: RankedJob[] = [];

  try {
    const discovery = await discoverJobs(
      { criteria: {} },
      {
        jobSource: deps.jobSource,
        claudeClient: deps.claudeClient,
        profile: matchingProfile,
        jobDiscoveryPreferences,
        topCount: options.topJobs,
        maxJobs: options.maxJobs,
        includeRankedJobs: true
      }
    );
    jobsDiscovered = discovery.jobsFound;
    jobsAfterFiltering = discovery.jobsAfterFiltering;
    jobsMatched = discovery.jobs.length;
    rankedJobs = discovery.rankedJobs ?? [];
    log({
      runId,
      stage: "discovery",
      jobsDiscovered,
      jobsAfterFiltering,
      jobsMatched,
      // Diagnostic only: each entry's `error` is already reduced to a safe
      // "ErrorName: message" string by toSafeErrorMessage() at the source
      // (jobAnalysisService.ts) — never a raw payload, resume, or secret.
      claudeMatchFailures: discovery.claudeFailures?.length
        ? discovery.claudeFailures.map((f) => f.error)
        : undefined
    });
  } catch (error) {
    log({ runId, stage: "discovery", status: "error", errorType: error instanceof Error ? error.name : "Unknown" });
    const completedAt = new Date();
    const result: CareerRunResult = {
      runId,
      status: "FAILED",
      jobsDiscovered,
      jobsAfterFiltering,
      jobsMatched,
      topJobs: [],
      applicationPackagesCreated: 0,
      whatsappNotificationsSent: 0,
      dryRun: options.dryRun,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString()
    };
    if (input.idempotencyKey) {
      deps.idempotencyStore?.set(input.idempotencyKey, result);
    }
    return result;
  }

  const packageResults: ApplicationPackageResult[] = [];
  const topJobSummaries: CareerRunTopJob[] = [];
  let hadPerJobFailures = false;

  // Sequential, not parallel — same reasoning as jobAnalysisService.ts: keeps
  // Claude call volume predictable for what is, at MVP scale, a small batch.
  // The `as Anthropic` casts below are safe: rankedJobs is only non-empty
  // when discoverJobs() above already succeeded at Claude job matching,
  // which itself requires deps.claudeClient to be a valid, defined client —
  // otherwise discoverJobs() would have thrown ClaudeNotConfiguredError and
  // this loop would never be reached (see the discovery try/catch above).
  for (const ranked of rankedJobs) {
    try {
      const tailored = await tailorResumeForJob(
        { job: ranked.job, careerProfile: resumeProfile, masterResume, jobPreferences },
        { claudeClient: deps.claudeClient as Anthropic }
      );
      const evidence = await verifyResumeEvidenceReport(
        { masterResume, careerProfile: resumeProfile, tailoredResume: tailored },
        { claudeClient: deps.claudeClient as Anthropic }
      );
      const qa = await reviewResume(
        { job: ranked.job, careerProfile: resumeProfile, masterResume, tailoredResume: tailored, evidenceGuardResult: evidence },
        { claudeClient: deps.claudeClient as Anthropic }
      );
      const pkg = await generateApplicationPackage(
        { job: ranked.job, jobMatch: ranked.match, careerProfile: resumeProfile, masterResume, tailoredResume: tailored, resumeQA: qa },
        { claudeClient: deps.claudeClient as Anthropic }
      );

      packageResults.push(pkg);
      topJobSummaries.push(toTopJobSummary(ranked, pkg.status));
      log({ runId, stage: "application_package", jobTitle: ranked.job.jobTitle, status: pkg.status });
    } catch (error) {
      hadPerJobFailures = true;
      log({
        runId,
        stage: "application_package",
        status: "error",
        errorType: error instanceof Error ? error.name : "Unknown",
        // Safe: toSafeErrorMessage() reduces to "ErrorName: message" only —
        // never a raw payload, resume, or secret (same pattern already used
        // for claudeMatchFailures above).
        errorDetail: toSafeErrorMessage(error)
      });
      // A single job's failure never aborts the run — continue with the rest.
    }
  }

  const applicationPackagesCreated = packageResults.filter((r) => r.status === "READY_FOR_REVIEW").length;

  let whatsappNotificationsSent = 0;
  let whatsappFailed = false;
  if (options.sendWhatsApp && !options.dryRun) {
    if (!deps.notificationProvider) {
      whatsappFailed = true;
      log({ runId, stage: "whatsapp", status: "error", errorType: "NotificationNotConfiguredError" });
    } else {
      try {
        const notifyResult = await notifyTopOpportunities({ packageResults }, { provider: deps.notificationProvider });
        whatsappNotificationsSent = notifyResult.notificationSent ? notifyResult.packagesEligible : 0;
        log({ runId, stage: "whatsapp", notificationsSent: whatsappNotificationsSent });
      } catch (error) {
        // A WhatsApp failure must never destroy the job analysis result (Phase 8 spec §8).
        whatsappFailed = true;
        log({ runId, stage: "whatsapp", status: "error", errorType: error instanceof Error ? error.name : "Unknown", error: toSafeErrorMessage(error) });
      }
    }
  }

  const status = determineStatus(jobsDiscovered, packageResults, hadPerJobFailures, whatsappFailed);
  const completedAt = new Date();

  const result: CareerRunResult = {
    runId,
    status,
    jobsDiscovered,
    jobsAfterFiltering,
    jobsMatched,
    topJobs: topJobSummaries,
    applicationPackagesCreated,
    whatsappNotificationsSent,
    dryRun: options.dryRun,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString()
  };

  log({ runId, stage: "complete", status, durationMs: completedAt.getTime() - startedAt.getTime() });

  if (input.idempotencyKey) {
    deps.idempotencyStore?.set(input.idempotencyKey, result);
  }

  return result;
}
