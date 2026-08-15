/**
 * Manual integration test for the real Claude API connection.
 *
 * This is NOT run by `npm test` — it makes a real, billable Claude API call
 * and is only meant to be run by hand when CLAUDE_API_KEY is configured.
 *
 * Usage:
 *   1. Set CLAUDE_API_KEY in your .env (see .env.example).
 *   2. Run: npm run test:claude
 */
import { createClaudeClient } from "../../src/services/claudeClient.js";
import { matchJobToProfile } from "../../src/agents/jobMatchingAgent.js";
import { JobSchema } from "../../src/schemas/job.js";
import { loadCareerProfile } from "../../src/services/profileService.js";
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
  const profile = loadCareerProfile();

  console.log(`Calling Claude for: ${job.jobTitle} @ ${job.company}...`);
  const match = await matchJobToProfile(job, profile, { client });

  console.log(JSON.stringify(match, null, 2));
}

main().catch((error) => {
  console.error("Real Claude integration test failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
