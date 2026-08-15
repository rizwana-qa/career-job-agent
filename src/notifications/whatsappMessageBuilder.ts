import type { ApplicationPackage } from "../schemas/applicationPackage.js";

const MAX_EVIDENCE_BULLETS = 3;
const SEPARATOR = "------------------------------------------------";

function orFallback(value: string | undefined | null, fallback: string): string {
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function formatSalary(pkg: ApplicationPackage): string {
  if (pkg.job.salary === "UNKNOWN") {
    return "UNKNOWN";
  }
  const currency = pkg.job.currency === "UNKNOWN" ? "" : ` ${pkg.job.currency}`;
  return `${pkg.job.salary.toLocaleString("en-US")}${currency}`;
}

function formatBullets(statements: { statement: string }[]): string {
  if (statements.length === 0) {
    return "  (none identified)";
  }
  return statements
    .slice(0, MAX_EVIDENCE_BULLETS)
    .map((s) => `• ${s.statement}`)
    .join("\n");
}

/**
 * Formats ONE opportunity block. Deliberately excludes:
 * - the full tailored resume (`pkg.resume.tailoredResume`, `pkg.resume.experience`)
 * - the drafted application message (`pkg.applicationMessage`)
 * - any career-profile content
 * per the Phase 7 privacy rules (§8) — only what's necessary to evaluate
 * the opportunity and know it's ready for review.
 */
function formatOpportunity(pkg: ApplicationPackage, index: number): string {
  const role = orFallback(pkg.role, "Role not specified");
  const company = orFallback(pkg.company, "Company not specified");
  const location = orFallback(pkg.job.location, "Location not specified");

  return [
    `${index}. ${role}`,
    company,
    location,
    pkg.job.remoteStatus,
    "",
    `Match Score: ${pkg.jobMatch.matchScore}/100 (${pkg.jobMatch.matchScoreLabel})`,
    `Interview Potential: ${pkg.jobMatch.interviewPotential}/100`,
    `Career Value: ${pkg.jobMatch.careerGrowth}/100`,
    `Salary: ${formatSalary(pkg)}`,
    "",
    "Why this matches:",
    formatBullets(pkg.jobMatch.strongMatches),
    "",
    "Important gaps:",
    formatBullets(pkg.jobMatch.gaps),
    "",
    `Resume QA: ${pkg.resumeQA.status}`,
    `Application Package: ${pkg.applicationStatus}`,
    "",
    `Job URL: ${pkg.sourceUrl}`
  ].join("\n");
}

/**
 * Builds the full WhatsApp digest text from already-computed
 * ApplicationPackages (Phase 5) — no Claude call, purely deterministic
 * formatting (Phase 7 spec §12, token efficiency). Every package passed in
 * has, by construction, already passed Job Matching, Ranking, Resume
 * Tailoring, Evidence Guard, and Resume QA (an ApplicationPackage cannot
 * exist otherwise — see applicationPackageService.ts) — nothing here needs
 * to re-check that.
 */
export function buildWhatsAppMessage(packages: ApplicationPackage[]): string {
  if (packages.length === 0) {
    return ["CAREER AGENT", "", "No new opportunities passed review right now."].join("\n");
  }

  const header = `CAREER AGENT\n\n${packages.length} opportunit${packages.length === 1 ? "y" : "ies"} found`;
  const opportunities = packages.map((pkg, i) => formatOpportunity(pkg, i + 1)).join(`\n\n${SEPARATOR}\n\n`);

  return `${header}\n\n${opportunities}`;
}
