import { env } from "../config/env.js";
import type { JobSource } from "./jobSource.js";
import { createRemotiveJobSource } from "./remotiveJobSource.js";
import { createIndeedJobSource } from "./indeedJobSource.js";
import { createNaukrigulfJobSource } from "./naukrigulfJobSource.js";
import { createGulfTalentJobSource } from "./gulfTalentJobSource.js";
import { createHimalayasJobSource } from "./himalayasJobSource.js";
import { createRemoteOkJobSource } from "./remoteOkJobSource.js";
import { createCareerjetJobSource } from "./careerjetJobSource.js";
import { createJobicyJobSource } from "./jobicyJobSource.js";
import { createJoobleJobSource } from "./joobleJobSource.js";
import { createWeWorkRemotelyJobSource } from "./weWorkRemotelyJobSource.js";

/**
 * Builds the list of enabled job sources from env config (Phase 8.4 §3,
 * extended by Phase 8.5's final source stack) — used only by
 * POST /career/discover-match's default dependency wiring (see
 * careerDiscoverMatch.ts). Order here is the deterministic query/dedup
 * order (Phase 8.5 §1's implementation order): Himalayas, Remote OK,
 * Careerjet, Remotive, Jobicy, Jooble, We Work Remotely, then the
 * manual-only Phase 8.4 placeholders (Indeed, Naukrigulf, GulfTalent).
 *
 * Every source here is opt-in via its own JOB_SOURCE_*_ENABLED flag. See
 * docs/JOB_SOURCES.md for why every Phase 8.5 flag defaults to false, even
 * for sources with a genuinely documented, no-credential public API: none
 * has been exercised with a real call from this codebase yet (no live
 * job-source calls were authorized during implementation).
 */
export function getEnabledJobSources(): JobSource[] {
  const sources: JobSource[] = [];
  if (env.jobSourceHimalayasEnabled) {
    sources.push(createHimalayasJobSource());
  }
  if (env.jobSourceRemoteOkEnabled) {
    sources.push(createRemoteOkJobSource());
  }
  if (env.jobSourceCareerjetEnabled) {
    sources.push(createCareerjetJobSource());
  }
  if (env.jobSourceRemotiveEnabled) {
    sources.push(createRemotiveJobSource());
  }
  if (env.jobSourceJobicyEnabled) {
    sources.push(createJobicyJobSource());
  }
  if (env.jobSourceJoobleEnabled) {
    sources.push(createJoobleJobSource());
  }
  if (env.jobSourceWweRemotelyEnabled) {
    sources.push(createWeWorkRemotelyJobSource());
  }
  if (env.jobSourceIndeedEnabled) {
    sources.push(createIndeedJobSource());
  }
  if (env.jobSourceNaukrigulfEnabled) {
    sources.push(createNaukrigulfJobSource());
  }
  if (env.jobSourceGulfTalentEnabled) {
    sources.push(createGulfTalentJobSource());
  }
  return sources;
}
