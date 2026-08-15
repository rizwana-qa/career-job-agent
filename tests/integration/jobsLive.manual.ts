/**
 * Manual live test against the real Remotive API (Phase 6).
 *
 * This is NOT run by `npm test`. It performs one small, controlled, read-only
 * search — it never modifies any state, never writes to disk, and never
 * calls Claude. Remotive requires no API key, but this script still fails
 * gracefully (rather than assuming network access) if the request fails for
 * any reason.
 *
 * Usage:
 *   npm run test:jobs:live
 *
 * Respects Remotive's own published rate-limit guidance via the same
 * throttle/cache used in production (REMOTIVE_MIN_FETCH_INTERVAL_HOURS,
 * default 6h) — running this script twice in quick succession reuses the
 * cached result rather than making a second live call.
 */
import { createRemotiveJobSource } from "../../src/jobSources/remotiveJobSource.js";
import { env } from "../../src/config/env.js";

const RESULT_LIMIT = 5;

async function main() {
  const jobSource = createRemotiveJobSource({
    minFetchIntervalMs: env.remotiveMinFetchIntervalHours * 60 * 60 * 1000
  });

  console.log(`Performing a small, controlled search against the real ${jobSource.name} API...`);

  const rawJobs = await jobSource.searchJobs({ roleKeywords: ["Quality Engineer"] });
  const limited = rawJobs.slice(0, RESULT_LIMIT);

  console.log(`Found ${rawJobs.length} raw jobs from the provider (showing up to ${RESULT_LIMIT}, no credentials involved):`);
  for (const raw of limited) {
    const normalized = jobSource.normalize(raw) as { jobTitle?: string; company?: string; sourceUrl?: string } | null;
    console.log(
      normalized
        ? `- ${normalized.jobTitle} @ ${normalized.company} — ${normalized.sourceUrl}`
        : "- (job could not be normalized — skipped, not fabricated)"
    );
  }
}

main().catch((error) => {
  console.error(
    "Live job source test failed gracefully (no credentials or state were affected):",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
