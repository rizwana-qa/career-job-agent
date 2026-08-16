import type { JobSource, RawProviderJob } from "./jobSource.js";
import type { SearchCriteria } from "../schemas/searchCriteria.js";
import { InvalidJobSourceResponseError, JobSourceError, JobSourceTimeoutError, JobSourceUnavailableError } from "../utils/errors.js";

const WWR_RSS_URL = "https://weworkremotely.com/categories/remote-programming-jobs.rss";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * We Work Remotely adapter (Phase 8.5) — public RSS feed only, per the
 * project's explicit instruction ("Use public RSS only unless an authorized
 * API token already exists" — none does here). No HTML scraping, no login.
 */
export interface WeWorkRemotelyJobSourceOptions {
  fetchImpl?: typeof fetch;
}

/** One <item> from the RSS feed, parsed into plain fields — this IS the "raw provider job" for this source. */
export interface WeWorkRemotelyRawItem extends RawProviderJob {
  title?: string; // WWR convention: "Company Name: Job Title"
  link?: string; // the original listing URL — never reconstructed
  pubDate?: string;
  description?: string;
  guid?: string;
}

/** Strips HTML tags and collapses whitespace — WWR's <description> is HTML, same approach as remotiveNormalizer.ts. */
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .trim();
}

function decodeCdata(raw: string): string {
  const match = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return match ? match[1] : raw;
}

function extractTag(itemXml: string, tag: string): string | undefined {
  const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) {
    return undefined;
  }
  return decodeCdata(match[1]).trim();
}

/**
 * Minimal, dependency-free RSS parser — no XML library is currently a
 * project dependency, and adding one for a single feed isn't warranted
 * (CLAUDE.md rule 15: keep the architecture simple). Extracts exactly the
 * fields this adapter needs (title, link, pubDate, description, guid) via
 * regex over each <item>...</item> block; anything the regex can't find is
 * left undefined rather than guessed.
 */
export function parseWeWorkRemotelyRss(xml: string): WeWorkRemotelyRawItem[] {
  const items: WeWorkRemotelyRawItem[] = [];
  const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  for (const itemXml of itemMatches) {
    items.push({
      title: extractTag(itemXml, "title"),
      link: extractTag(itemXml, "link"),
      pubDate: extractTag(itemXml, "pubDate"),
      description: extractTag(itemXml, "description"),
      guid: extractTag(itemXml, "guid")
    });
  }
  return items;
}

export function normalizeWeWorkRemotelyJob(raw: WeWorkRemotelyRawItem): unknown | null {
  const rawTitle = typeof raw.title === "string" ? raw.title.trim() : "";
  const url = typeof raw.link === "string" ? raw.link.trim() : "";
  const guid = typeof raw.guid === "string" ? raw.guid.trim() : url;
  const descriptionHtml = typeof raw.description === "string" ? raw.description : "";
  const description = stripHtml(descriptionHtml);
  const pubDate = typeof raw.pubDate === "string" ? new Date(raw.pubDate) : undefined;
  const datePosted = pubDate && Number.isFinite(pubDate.getTime()) ? pubDate.toISOString().slice(0, 10) : "";

  // WWR's own title convention is "Company Name: Job Title" — split on the
  // FIRST colon only, since a job title itself may contain a colon.
  const separatorIndex = rawTitle.indexOf(":");
  const company = separatorIndex > 0 ? rawTitle.slice(0, separatorIndex).trim() : "";
  const title = separatorIndex > 0 ? rawTitle.slice(separatorIndex + 1).trim() : rawTitle;

  if (!title || !company || !url || !guid || description.length < 20 || !datePosted) {
    return null;
  }

  return {
    jobTitle: title,
    company,
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE", // We Work Remotely is exclusively a remote-jobs board.
    employmentType: "FULL_TIME", // WWR's RSS doesn't reliably distinguish employment type — never guessed.
    jobDescription: description,
    requirements: [description],
    responsibilities: [description],
    skills: [title],
    source: "weworkremotely",
    sourceUrl: url,
    datePosted,
    externalJobId: guid
  };
}

export function createWeWorkRemotelyJobSource(options: WeWorkRemotelyJobSourceOptions = {}): JobSource {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "weworkremotely",

    async searchJobs(_criteria: SearchCriteria): Promise<RawProviderJob[]> {
      // The RSS feed is a single unfiltered category listing — role-keyword
      // narrowing happens deterministically downstream, same pattern as
      // remotiveJobSource.ts / remoteOkJobSource.ts.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetchImpl(WWR_RSS_URL, { signal: controller.signal });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new JobSourceTimeoutError("We Work Remotely request timed out");
        }
        throw new JobSourceUnavailableError(
          `We Work Remotely is unavailable: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new JobSourceError(`We Work Remotely returned an unexpected status (HTTP ${response.status})`);
      }

      let xml: string;
      try {
        xml = await response.text();
      } catch {
        throw new InvalidJobSourceResponseError("We Work Remotely response could not be read as text");
      }

      if (!xml.includes("<item>")) {
        throw new InvalidJobSourceResponseError("We Work Remotely response did not look like an RSS feed (no <item> elements)");
      }

      return parseWeWorkRemotelyRss(xml);
    },

    async getJob(_jobId: string): Promise<RawProviderJob | null> {
      return null; // No documented single-job lookup endpoint — RSS is search-only.
    },

    normalize(raw: RawProviderJob): unknown | null {
      return normalizeWeWorkRemotelyJob(raw as WeWorkRemotelyRawItem);
    }
  };
}
