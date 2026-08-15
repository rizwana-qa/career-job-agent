/**
 * Manual integration test for the real Claude API connection (Resume QA).
 *
 * This is NOT run by `npm test` — it makes a real, billable Claude API call
 * and is only meant to be run by hand when CLAUDE_API_KEY is configured.
 *
 * Usage:
 *   1. Set CLAUDE_API_KEY in your .env (see .env.example).
 *   2. Fill in profile/master_resume.md and profile/career_profile.md with
 *      real content (the placeholders will cause this script to exit early).
 *   3. Run: npm run test:claude:resume-qa
 *
 * This script intentionally does NOT print the full tailored resume, master
 * resume, career profile, or any personal contact information — only
 * summary fields — per the "do not log resume content / personal details"
 * security rule.
 */
import { createClaudeClient } from "../../src/services/claudeClient.js";
import { tailorResumeForJob } from "../../src/services/resumeTailoringService.js";
import { verifyResumeEvidenceReport } from "../../src/services/resumeEvidenceService.js";
import { reviewResume } from "../../src/services/resumeQAService.js";
import {
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
  const job = loadJobFixture("04-ai-quality-engineer.json");
  const careerProfile = loadCareerProfileForResumeTailoring();
  const masterResume = loadMasterResume();
  const jobPreferences = loadResumeRelevantJobPreferences();

  if (Object.keys(careerProfile).length === 0 || masterResume.length === 0) {
    console.error(
      "profile/career_profile.md and/or profile/master_resume.md still look unfilled.\n" +
        "Fill them in with real content before running this script."
    );
    process.exitCode = 1;
    return;
  }

  console.log("Step 1/3: Tailoring a resume for the AI Quality Engineer fixture job...");
  const tailored = await tailorResumeForJob(
    { job, careerProfile, masterResume, jobPreferences },
    { claudeClient: client }
  );

  console.log("Step 2/3: Running the Evidence Guard over the tailored resume...");
  const evidence = await verifyResumeEvidenceReport(
    { masterResume, careerProfile, tailoredResume: tailored },
    { claudeClient: client }
  );

  console.log("Step 3/3: Running the independent Resume QA review...");
  const qa = await reviewResume(
    { job, careerProfile, masterResume, tailoredResume: tailored, evidenceGuardResult: evidence },
    { claudeClient: client }
  );

  // Summary only — never the full resume, profile, or contact information.
  console.log(
    JSON.stringify(
      {
        qaStatus: qa.status,
        humanReviewRequired: qa.humanReviewRequired,
        overallScore: qa.overallScore,
        jdAlignmentScore: qa.jdAlignmentScore,
        factualAccuracyScore: qa.factualAccuracyScore,
        interviewReadinessScore: qa.interviewReadinessScore,
        criticalIssueCount: qa.criticalIssues.length,
        highIssueCount: qa.highIssues.length,
        mediumIssueCount: qa.mediumIssues.length,
        lowIssueCount: qa.lowIssues.length,
        evidenceGuardStatus: evidence.status
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Real Claude resume-QA integration test failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
