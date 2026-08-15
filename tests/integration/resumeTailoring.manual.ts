/**
 * Manual integration test for the real Claude API connection (Resume Tailoring).
 *
 * This is NOT run by `npm test` — it makes a real, billable Claude API call
 * and is only meant to be run by hand when CLAUDE_API_KEY is configured.
 *
 * Usage:
 *   1. Set CLAUDE_API_KEY in your .env (see .env.example).
 *   2. Fill in profile/master_resume.md and profile/career_profile.md with
 *      real content (the placeholders will cause this script to exit early).
 *   3. Run: npm run test:claude:resume
 *
 * This script intentionally does NOT print the full tailored resume,
 * career profile, or master resume to the console — only summary fields —
 * per the "do not log full resume / full career profile" security rule.
 */
import { createClaudeClient } from "../../src/services/claudeClient.js";
import { tailorResumeForJob } from "../../src/services/resumeTailoringService.js";
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

  console.log("Calling Claude to tailor a resume for the AI Quality Engineer fixture job...");
  const result = await tailorResumeForJob(
    { job, careerProfile, masterResume, jobPreferences },
    { claudeClient: client }
  );

  // Summary only — never the full resume/profile content.
  console.log(
    JSON.stringify(
      {
        status: result.status,
        targetRole: result.targetRole,
        targetCompany: result.targetCompany,
        jdKeywordAlignment: result.jdKeywordAlignment,
        unsupportedClaims: result.unsupportedClaims,
        matchedRequirementsCount: result.matchedRequirements.length,
        gapsCount: result.gaps.length,
        claimsRequiringVerificationCount: result.claimsRequiringVerification.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Real Claude resume-tailoring integration test failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
