/**
 * Manual live test for the career orchestration API (Phase 8).
 *
 * This is NOT run by `npm test`. It calls the real, in-process orchestration
 * pipeline (real Remotive, real Claude if configured, real profile files) —
 * but ALWAYS with dryRun=true and sendWhatsApp=false, regardless of what's
 * configured, so it never sends a WhatsApp message and never creates
 * anything beyond an in-memory result.
 *
 * Usage:
 *   npm run test:career:live
 *
 * Requires CLAUDE_API_KEY (job matching/tailoring/QA/package all need it)
 * and real content in profile/master_resume.md + profile/career_profile.md.
 * Exits gracefully if either is missing — no partial/misleading run.
 */
import { runCareerPipeline } from "../../src/services/careerOrchestrationService.js";
import { createClaudeClient } from "../../src/services/claudeClient.js";
import { createRemotiveJobSource } from "../../src/jobSources/remotiveJobSource.js";
import { loadCareerProfileForResumeTailoring, loadMasterResume } from "../../src/services/profileService.js";
import { env } from "../../src/config/env.js";

async function main() {
  if (!env.claudeApiKey) {
    console.error(
      "CLAUDE_API_KEY is not set. The orchestration pipeline needs it for job matching, resume\n" +
        "tailoring, evidence guard, resume QA, and application package generation. Skipping — no\n" +
        "network calls were made.\n" +
        "See .env.example."
    );
    process.exitCode = 1;
    return;
  }

  const resumeProfile = loadCareerProfileForResumeTailoring();
  const masterResume = loadMasterResume();
  if (Object.keys(resumeProfile).length === 0 || masterResume.length === 0) {
    console.error(
      "profile/career_profile.md and/or profile/master_resume.md still look unfilled.\n" +
        "Fill them in with real content before running this script."
    );
    process.exitCode = 1;
    return;
  }

  console.log("Running the real orchestration pipeline (dryRun=true, sendWhatsApp=false — forced, not overridable)...");

  const result = await runCareerPipeline(
    {
      // dryRun/sendWhatsApp are forced below regardless of what's passed here,
      // but stated explicitly for clarity.
      options: { maxJobs: 10, topJobs: 3, sendWhatsApp: false, dryRun: true }
    },
    {
      jobSource: createRemotiveJobSource(),
      claudeClient: createClaudeClient()
      // notificationProvider deliberately omitted — sendWhatsApp is false, so it's never used.
    }
  );

  // Safe summary only — never full resumes or personal data.
  console.log(
    JSON.stringify(
      {
        runId: result.runId,
        status: result.status,
        jobsDiscovered: result.jobsDiscovered,
        jobsAfterFiltering: result.jobsAfterFiltering,
        jobsMatched: result.jobsMatched,
        topJobs: result.topJobs,
        applicationPackagesCreated: result.applicationPackagesCreated,
        whatsappNotificationsSent: result.whatsappNotificationsSent,
        dryRun: result.dryRun,
        durationMs: new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime()
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Live career orchestration test failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
