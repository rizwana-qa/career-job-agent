/**
 * Manual integration test for the real Claude API connection (Application Package).
 *
 * This is NOT run by `npm test` — it makes real, billable Claude API calls
 * and is only meant to be run by hand when CLAUDE_API_KEY is configured.
 *
 * Usage:
 *   1. Set CLAUDE_API_KEY in your .env (see .env.example).
 *   2. Fill in profile/master_resume.md and profile/career_profile.md with
 *      real content (the placeholders will cause this script to exit early).
 *   3. Run: npm run test:claude:application
 *
 * This script intentionally does NOT print the full resume, master resume,
 * career profile, or any personal contact information — only summary
 * fields — per the "do not log resume content / personal details"
 * security rule.
 */
import { createClaudeClient } from "../../src/services/claudeClient.js";
import { matchJobToProfile } from "../../src/agents/jobMatchingAgent.js";
import { tailorResumeForJob } from "../../src/services/resumeTailoringService.js";
import { verifyResumeEvidenceReport } from "../../src/services/resumeEvidenceService.js";
import { reviewResume } from "../../src/services/resumeQAService.js";
import { generateApplicationPackage } from "../../src/services/applicationPackageService.js";
import { JobSchema } from "../../src/schemas/job.js";
import {
  loadCareerProfile,
  loadCareerProfileForResumeTailoring,
  loadMasterResume,
  loadResumeRelevantJobPreferences
} from "../../src/services/profileService.js";
import { loadJobFixture } from "../helpers/fixtures.js";
import { env } from "../../src/config/env.js";

async function main() {
  if (!env.claudeApiKey) {
    console.error(
      "CLAUDE_API_KEY is not set. This script requires a real key — see .env.example.\n" +
        "Skipping real Claude integration test."
    );
    process.exitCode = 1;
    return;
  }

  const client = createClaudeClient();
  const job = JobSchema.parse(loadJobFixture("04-ai-quality-engineer.json"));
  const matchingProfile = loadCareerProfile();
  const resumeProfile = loadCareerProfileForResumeTailoring();
  const masterResume = loadMasterResume();
  const jobPreferences = loadResumeRelevantJobPreferences();

  if (Object.keys(resumeProfile).length === 0 || masterResume.length === 0) {
    console.error(
      "profile/career_profile.md and/or profile/master_resume.md still look unfilled.\n" +
        "Fill them in with real content before running this script."
    );
    process.exitCode = 1;
    return;
  }

  console.log("Step 1/4: Job matching...");
  const jobMatch = await matchJobToProfile(job, matchingProfile, { client });

  console.log("Step 2/4: Tailoring the resume...");
  const tailored = await tailorResumeForJob(
    { job, careerProfile: resumeProfile, masterResume, jobPreferences },
    { claudeClient: client }
  );

  console.log("Step 3/4: Running the Evidence Guard...");
  const evidence = await verifyResumeEvidenceReport(
    { masterResume, careerProfile: resumeProfile, tailoredResume: tailored },
    { claudeClient: client }
  );

  console.log("Step 4/4: Running Resume QA, then attempting to build the Application Package...");
  const qa = await reviewResume(
    { job, careerProfile: resumeProfile, masterResume, tailoredResume: tailored, evidenceGuardResult: evidence },
    { claudeClient: client }
  );

  const result = await generateApplicationPackage(
    { job, jobMatch, careerProfile: resumeProfile, masterResume, tailoredResume: tailored, resumeQA: qa },
    { claudeClient: client }
  );

  // Summary only — never the full resume, profile, or contact information.
  if (result.status === "READY_FOR_REVIEW") {
    console.log(
      JSON.stringify(
        {
          status: result.status,
          applicationId: result.applicationId,
          resumeVersion: result.resumeVersion,
          matchScore: result.matchScore,
          qaStatus: result.qaStatus,
          applicationMessageUnsupportedClaims: result.applicationMessageUnsupportedClaims,
          applicationMessageLength: result.applicationMessage.length
        },
        null,
        2
      )
    );
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error("Real Claude application-package integration test failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
