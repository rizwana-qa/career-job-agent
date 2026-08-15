import { Router } from "express";
import type Anthropic from "@anthropic-ai/sdk";
import { createClaudeClient } from "../../services/claudeClient.js";
import { tailorResumeForJob } from "../../services/resumeTailoringService.js";
import { verifyResumeEvidenceReport } from "../../services/resumeEvidenceService.js";
import { reviewResume } from "../../services/resumeQAService.js";
import { generateApplicationPackage } from "../../services/applicationPackageService.js";
import {
  loadCareerProfileForResumeTailoring,
  loadMasterResume,
  loadResumeRelevantJobPreferences,
  type ResumeRelevantJobPreferences,
  type ResumeRelevantProfileFields
} from "../../services/profileService.js";
import { ProcessJobRequestSchema, type ProcessJobResult } from "../../schemas/careerProcessJob.js";
import { InMemoryIdempotencyStore, type IdempotencyStore } from "../../services/careerOrchestrationService.js";
import { toSafeErrorMessage } from "../../utils/errors.js";
import { formatZodIssues } from "../../utils/zod.js";
import { authenticateCareerAgentRequest } from "./careerAuth.js";

export interface CareerProcessJobRouterDependencies {
  claudeClient?: Anthropic;
  resumeProfile?: ResumeRelevantProfileFields;
  masterResume?: string;
  jobPreferences?: ResumeRelevantJobPreferences;
  idempotencyStore?: IdempotencyStore<ProcessJobResult>;
  /** Overrides env.careerAgentApiKey — mainly for tests. */
  apiKey?: string;
}

let defaultIdempotencyStore: IdempotencyStore<ProcessJobResult> | undefined;
function getDefaultIdempotencyStore(): IdempotencyStore<ProcessJobResult> {
  if (!defaultIdempotencyStore) {
    defaultIdempotencyStore = new InMemoryIdempotencyStore<ProcessJobResult>();
  }
  return defaultIdempotencyStore;
}

/**
 * POST /career/process-job — Phase 8.2, endpoint 2 of 2. Takes ONE already-
 * matched job (as returned by POST /career/discover-match's `jobData` field
 * — see that route for why the full job+match payload must be round-
 * tripped rather than looked up by ID) and runs the existing, unchanged
 * Resume Tailoring -> Evidence Guard -> Resume QA -> Application Package
 * chain for it — exactly the same four calls careerOrchestrationService.ts
 * already makes per job, just for one job per request instead of an
 * unbounded loop over many, keeping this call comfortably inside Vercel's
 * function duration limit regardless of how many jobs a discovery run found.
 */
export function createCareerProcessJobRouter(deps: CareerProcessJobRouterDependencies = {}): Router {
  const router = Router();

  router.post("/career/process-job", async (req, res) => {
    if (!authenticateCareerAgentRequest(req, res, deps.apiKey)) {
      return;
    }

    const idempotencyStore = deps.idempotencyStore ?? getDefaultIdempotencyStore();
    const idempotencyKey = req.header("Idempotency-Key");
    if (idempotencyKey) {
      const cached = idempotencyStore.get(idempotencyKey);
      if (cached) {
        res.status(200).json(cached);
        return;
      }
    }

    const parsedRequest = ProcessJobRequestSchema.safeParse(req.body ?? {});
    if (!parsedRequest.success) {
      res.status(400).json({ error: "Invalid request body", details: formatZodIssues(parsedRequest.error) });
      return;
    }
    const { jobId, jobData } = parsedRequest.data;

    // Sanity cross-check: catches a caller sending a jobId that doesn't
    // match the jobData it also sent (stale/mismatched round-trip), rather
    // than silently processing the wrong job under the requested jobId.
    const derivedJobId = jobData.job.externalJobId ?? jobData.job.sourceUrl;
    if (derivedJobId !== jobId) {
      res.status(400).json({ error: "jobId does not match jobData.job" });
      return;
    }

    let claudeClient: Anthropic | undefined = deps.claudeClient;
    if (!claudeClient) {
      try {
        claudeClient = createClaudeClient();
      } catch {
        claudeClient = undefined;
      }
    }
    if (!claudeClient) {
      res.status(503).json({ error: "Claude API is not configured" });
      return;
    }

    let resumeProfile: ResumeRelevantProfileFields;
    let masterResume: string;
    let jobPreferences: ResumeRelevantJobPreferences;
    try {
      resumeProfile = deps.resumeProfile ?? loadCareerProfileForResumeTailoring();
      masterResume = deps.masterResume ?? loadMasterResume();
      jobPreferences = deps.jobPreferences ?? loadResumeRelevantJobPreferences();
    } catch (error) {
      console.error("POST /career/process-job: failed to load profile/resume:", toSafeErrorMessage(error));
      res.status(500).json({ error: "Career profile or master resume could not be loaded" });
      return;
    }

    let result: ProcessJobResult;
    try {
      const tailored = await tailorResumeForJob(
        { job: jobData.job, careerProfile: resumeProfile, masterResume, jobPreferences },
        { claudeClient }
      );
      const evidence = await verifyResumeEvidenceReport(
        { masterResume, careerProfile: resumeProfile, tailoredResume: tailored },
        { claudeClient }
      );
      const qa = await reviewResume(
        { job: jobData.job, careerProfile: resumeProfile, masterResume, tailoredResume: tailored, evidenceGuardResult: evidence },
        { claudeClient }
      );
      const pkg = await generateApplicationPackage(
        { job: jobData.job, jobMatch: jobData.match, careerProfile: resumeProfile, masterResume, tailoredResume: tailored, resumeQA: qa },
        { claudeClient }
      );

      const applicationPackageCreated = pkg.status === "READY_FOR_REVIEW";
      result = {
        // A non-PASS QA verdict is a legitimate, non-exceptional outcome
        // (same convention as careerOrchestrationService.ts's per-job loop)
        // — PARTIAL, not FAILED. FAILED is reserved for the catch block
        // below, where a stage genuinely threw.
        status: applicationPackageCreated ? "COMPLETED" : "PARTIAL",
        jobId,
        company: jobData.job.company,
        jobTitle: jobData.job.jobTitle,
        resumeQAStatus: qa.status,
        resumeQAOverallScore: qa.overallScore,
        applicationPackageCreated
      };
    } catch (error) {
      console.error("POST /career/process-job failed:", toSafeErrorMessage(error));
      result = {
        status: "FAILED",
        jobId,
        company: jobData.job.company,
        jobTitle: jobData.job.jobTitle,
        resumeQAStatus: "NOT_REACHED",
        resumeQAOverallScore: 0,
        applicationPackageCreated: false
      };
    }

    if (idempotencyKey) {
      idempotencyStore.set(idempotencyKey, result);
    }
    res.status(200).json(result);
  });

  return router;
}
