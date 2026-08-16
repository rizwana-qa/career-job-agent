import type { JobSource, RawProviderJob } from "./jobSource.js";
import type { SearchCriteria } from "../schemas/searchCriteria.js";
import { env } from "../config/env.js";
import { JobSourceAuthError, JobSourceUnavailableError } from "../utils/errors.js";

/**
 * Jooble adapter — PLACEHOLDER (Phase 8.5). Jooble's REST API is a real,
 * documented API, but it requires an API key (JOOBLE_API_KEY in env.ts)
 * which is not configured in this environment. `searchJobs()` intentionally
 * throws until a real, credentialed request is wired in — never an
 * undocumented/scraped call, never an invented key. The key is designed to
 * stay server-side only (read from process.env, never exposed in any
 * response).
 *
 * `normalize()` is fully implemented against a REASONABLE PLACEHOLDER raw
 * shape (typical of Jooble's documented REST response fields), ready in
 * advance — this raw shape MUST be verified/adjusted against the real API
 * once the key is available.
 */
export interface JoobleRawJob extends RawProviderJob {
  id?: string | number;
  title?: string;
  company?: string;
  location?: string;
  snippet?: string; // Jooble's short description field
  updated?: string; // ISO date string
  link?: string; // Jooble's own listing/redirect URL
  salary?: string; // free text
}

export function normalizeJoobleJob(raw: JoobleRawJob): unknown | null {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const company = typeof raw.company === "string" ? raw.company.trim() : "";
  const url = typeof raw.link === "string" ? raw.link.trim() : "";
  const id = raw.id;
  const description = typeof raw.snippet === "string" ? raw.snippet.trim() : "";
  const location = typeof raw.location === "string" && raw.location.trim().length > 0 ? raw.location.trim() : "";
  const country = location.includes(",") ? location.split(",").slice(-1)[0].trim() : location;
  const datePosted = typeof raw.updated === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.updated) ? raw.updated.slice(0, 10) : "";

  if (!title || !company || !url || id === undefined || id === null || description.length < 20 || !location || !country || !datePosted) {
    return null;
  }

  return {
    jobTitle: title,
    company,
    location,
    country,
    remoteStatus: "ONSITE", // Jooble's placeholder shape doesn't expose a remote flag — never assumed.
    employmentType: "FULL_TIME", // Jooble's documented feed doesn't reliably distinguish employment type in this placeholder shape.
    jobDescription: description,
    requirements: [description],
    responsibilities: [description],
    skills: [title],
    source: "jooble",
    sourceUrl: url,
    datePosted,
    externalJobId: String(id)
  };
}

export function createJoobleJobSource(): JobSource {
  return {
    name: "jooble",

    async searchJobs(_criteria: SearchCriteria): Promise<RawProviderJob[]> {
      if (!env.joobleApiKey) {
        throw new JobSourceAuthError("Jooble integration requires JOOBLE_API_KEY, which is not configured (see docs/JOB_SOURCES.md).");
      }
      throw new JobSourceUnavailableError(
        "Jooble integration is not yet wired to a live request — see docs/JOB_SOURCES.md for what's required before enabling this in production."
      );
    },

    async getJob(_jobId: string): Promise<RawProviderJob | null> {
      return null;
    },

    normalize(raw: RawProviderJob): unknown | null {
      return normalizeJoobleJob(raw as JoobleRawJob);
    }
  };
}
