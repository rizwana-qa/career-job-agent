import type { RawProviderJob } from "./jobSource.js";

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACT",
  freelance: "FREELANCE",
  internship: "INTERNSHIP"
};

/** Strips HTML tags and collapses whitespace — dependency-free, since Remotive's `description` is HTML. */
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
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Mechanically chunks plain text into non-empty lines/paragraphs. Used for
 * both `requirements` and `responsibilities` (see below) — Remotive doesn't
 * separate these, and guessing which sentences are "requirements" versus
 * "responsibilities" would mean inventing a classification the source data
 * doesn't provide. Both fields get the same real text, chunked, not invented.
 */
function chunkDescription(plainText: string): string[] {
  const byLine = plainText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 3);
  if (byLine.length > 1) {
    return byLine;
  }

  const bySentence = plainText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  if (bySentence.length > 0) {
    return bySentence;
  }

  return plainText.trim().length > 0 ? [plainText.trim()] : [];
}

/**
 * Conservative, non-inventive salary parsing. Remotive's `salary` field is
 * free text ("$70,000 - $90,000", "Pay per task", "", etc.) — only a clean
 * dollar figure or range is extracted; anything else is left undefined
 * (never guessed), consistent with CLAUDE.md rule 5.
 */
function parseSalary(raw: string | undefined): { salary?: number; currency?: string } {
  if (!raw || !raw.includes("$")) {
    return {};
  }

  const numbers = raw.match(/[\d,]+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) {
    return {};
  }

  const values = numbers.map((n) => Number(n.replace(/,/g, ""))).filter((n) => Number.isFinite(n) && n > 0);
  if (values.length === 0) {
    return {};
  }

  const salary = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return { salary, currency: "USD" };
}

/**
 * Maps one raw Remotive job toward the Job schema shape. Returns null (not
 * a partially-invented object) when a required field — currently only
 * employmentType — can't be honestly derived from an unrecognized
 * `job_type` value, since guessing the closest category would misrepresent
 * the source.
 */
export function normalizeRemotiveJob(raw: RawProviderJob): unknown | null {
  const jobType = typeof raw.job_type === "string" ? raw.job_type : "";
  const employmentType = EMPLOYMENT_TYPE_MAP[jobType];
  if (!employmentType) {
    return null;
  }

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const company = typeof raw.company_name === "string" ? raw.company_name.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const id = raw.id;
  const candidateLocation = typeof raw.candidate_required_location === "string" ? raw.candidate_required_location.trim() : "";
  const publicationDate = typeof raw.publication_date === "string" ? raw.publication_date : "";
  const descriptionHtml = typeof raw.description === "string" ? raw.description : "";
  const plainDescription = stripHtml(descriptionHtml);
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0) : [];

  if (!title || !company || !url || id === undefined || id === null || plainDescription.length < 20) {
    return null;
  }

  const chunks = chunkDescription(plainDescription);
  const skills = tags.length > 0 ? tags : chunks;
  const country = candidateLocation ? candidateLocation.split(",")[0].trim() : "Worldwide";
  const location = candidateLocation || "Worldwide";
  const datePosted = publicationDate.length >= 10 ? publicationDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const { salary, currency } = parseSalary(typeof raw.salary === "string" ? raw.salary : undefined);

  return {
    jobTitle: title,
    company,
    location,
    country,
    remoteStatus: "REMOTE", // Remotive is exclusively a remote-jobs board — this accurately reflects the source, not an assumption.
    employmentType,
    jobDescription: plainDescription,
    requirements: chunks.length > 0 ? chunks : [plainDescription],
    responsibilities: chunks.length > 0 ? chunks : [plainDescription],
    skills: skills.length > 0 ? skills : [title],
    source: "remotive",
    sourceUrl: url,
    datePosted,
    ...(salary !== undefined ? { salary, currency } : {}),
    externalJobId: String(id)
  };
}
