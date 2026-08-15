import { env } from "../config/env.js";
import type { JobSource } from "./jobSource.js";
import { createRemotiveJobSource } from "./remotiveJobSource.js";
import { createIndeedJobSource } from "./indeedJobSource.js";
import { createNaukrigulfJobSource } from "./naukrigulfJobSource.js";
import { createGulfTalentJobSource } from "./gulfTalentJobSource.js";

/**
 * Builds the list of enabled job sources from env config (Phase 8.4 §3) —
 * used only by POST /career/discover-match's default dependency wiring (see
 * careerDiscoverMatch.ts). Remotive is enabled by default; every other
 * source is opt-in via its own JOB_SOURCE_*_ENABLED flag and is currently a
 * placeholder adapter that fails per-source (see docs/JOB_SOURCES.md) rather
 * than silently doing nothing if enabled without real access.
 */
export function getEnabledJobSources(): JobSource[] {
  const sources: JobSource[] = [];
  if (env.jobSourceRemotiveEnabled) {
    sources.push(createRemotiveJobSource());
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
