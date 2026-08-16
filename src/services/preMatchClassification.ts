import type { Job } from "../schemas/job.js";
import { isHardNegativeRole, hasPositiveCareerSignal, isNonSoftwareQaRole } from "./careerRelevanceFilter.js";
import { isLocationEligible } from "./locationEligibilityFilter.js";
import { classifySearchTier } from "./searchTierClassifier.js";

/**
 * Phase 8.5.17 — pre-Claude funnel observability. Each job that reaches the
 * pre-Claude filter stage gets exactly ONE deterministic outcome, checked in
 * the SAME order as careerDiscoverMatch.ts's existing filter chain (Phase
 * 8.3.3/8.5 §6-8, unchanged): location eligibility -> hard negative title ->
 * non-software-QA -> positive career signal -> qualified. This is a single
 * source of truth for that ordering — careerDiscoverMatch.ts's actual filter
 * predicate is derived from this function's result, so the real filtering
 * behavior (which jobs pass, in what order, capped how) is completely
 * unchanged; this only adds a name for *why* each job resolved the way it did.
 */
export type PreMatchOutcome =
  | "LOCATION_REJECTED"
  | "HARD_NEGATIVE_REJECTED"
  | "NON_SOFTWARE_QA_REJECTED"
  | "POSITIVE_CAREER_REJECTED"
  | "QUALIFIED_FOR_MATCHING";

export function classifyPreMatchOutcome(job: Job): PreMatchOutcome {
  if (!isLocationEligible(job)) {
    return "LOCATION_REJECTED";
  }
  if (isHardNegativeRole(job)) {
    return "HARD_NEGATIVE_REJECTED";
  }
  if (isNonSoftwareQaRole(job)) {
    return "NON_SOFTWARE_QA_REJECTED";
  }
  if (!hasPositiveCareerSignal(job)) {
    return "POSITIVE_CAREER_REJECTED";
  }
  return "QUALIFIED_FOR_MATCHING";
}

export interface PreMatchSourceBreakdown {
  /** Jobs from this source that reached the pre-Claude filter stage (i.e. already passed the earlier basic/Phase-2 filter). */
  afterBasicFilter: number;
  qualified: number;
  rejected: number;
}

export interface PreMatchDiagnostics {
  locationRejected: number;
  hardNegativeRejected: number;
  nonSoftwareQaRejected: number;
  positiveCareerRejected: number;
  qualifiedForMatching: number;
  /**
   * Tier counts at two stages. A true "RAW" (pre-basic-filter) stage isn't
   * included: the raw, pre-dedup, pre-basic-filter job list never reaches
   * this endpoint's route layer (discoverJobs()/analyzeJobs() only return
   * aggregate counts for that stage, by design, to keep the response small)
   * — adding it would require threading full raw job lists through several
   * layers, a bigger change than "observability only" calls for. The
   * post-Claude-match tier breakdown is already covered by the existing,
   * unchanged `searchResultsByTier` top-level response field (Phase 8.5.7).
   */
  byTier: {
    afterBasicFilter: Record<string, number>;
    qualifiedForMatching: Record<string, number>;
  };
  bySource: Record<string, PreMatchSourceBreakdown>;
}

/**
 * Aggregates the outcome of every job that reached the pre-Claude filter
 * stage (i.e. the full "after basic filter" set) into the counters/tallies
 * above. Pure — no logging, no side effects — so it's directly testable and
 * reusable regardless of how the caller collected the job list.
 */
export function buildPreMatchDiagnostics(jobs: readonly Job[]): PreMatchDiagnostics {
  const diagnostics: PreMatchDiagnostics = {
    locationRejected: 0,
    hardNegativeRejected: 0,
    nonSoftwareQaRejected: 0,
    positiveCareerRejected: 0,
    qualifiedForMatching: 0,
    byTier: { afterBasicFilter: {}, qualifiedForMatching: {} },
    bySource: {}
  };

  for (const job of jobs) {
    const outcome = classifyPreMatchOutcome(job);
    const tier = classifySearchTier(job);

    diagnostics.byTier.afterBasicFilter[tier] = (diagnostics.byTier.afterBasicFilter[tier] ?? 0) + 1;

    const sourceBreakdown = diagnostics.bySource[job.source] ?? { afterBasicFilter: 0, qualified: 0, rejected: 0 };
    sourceBreakdown.afterBasicFilter += 1;

    switch (outcome) {
      case "LOCATION_REJECTED":
        diagnostics.locationRejected += 1;
        sourceBreakdown.rejected += 1;
        break;
      case "HARD_NEGATIVE_REJECTED":
        diagnostics.hardNegativeRejected += 1;
        sourceBreakdown.rejected += 1;
        break;
      case "NON_SOFTWARE_QA_REJECTED":
        diagnostics.nonSoftwareQaRejected += 1;
        sourceBreakdown.rejected += 1;
        break;
      case "POSITIVE_CAREER_REJECTED":
        diagnostics.positiveCareerRejected += 1;
        sourceBreakdown.rejected += 1;
        break;
      case "QUALIFIED_FOR_MATCHING":
        diagnostics.qualifiedForMatching += 1;
        sourceBreakdown.qualified += 1;
        diagnostics.byTier.qualifiedForMatching[tier] = (diagnostics.byTier.qualifiedForMatching[tier] ?? 0) + 1;
        break;
    }

    diagnostics.bySource[job.source] = sourceBreakdown;
  }

  return diagnostics;
}

/** Safe per-job diagnostic (Phase 8.5.17 §3) — never full description, resume, career profile, Claude prompt, or credentials. */
export function logPreMatchOutcome(job: Job, outcome: PreMatchOutcome): void {
  if (outcome === "QUALIFIED_FOR_MATCHING") {
    console.log(
      JSON.stringify({
        source: "career-agent",
        stage: "pre_claude_filter",
        jobTitle: job.jobTitle,
        company: job.company,
        sourceName: job.source,
        searchTier: classifySearchTier(job),
        status: "QUALIFIED_FOR_MATCHING"
      })
    );
    return;
  }
  console.log(
    JSON.stringify({
      source: "career-agent",
      stage: "pre_claude_filter",
      event: "rejected",
      jobTitle: job.jobTitle,
      company: job.company,
      sourceName: job.source,
      rejectionStage: outcome,
      rejectionReason: describePreMatchRejectionReason(outcome)
    })
  );
}

function describePreMatchRejectionReason(outcome: Exclude<PreMatchOutcome, "QUALIFIED_FOR_MATCHING">): string {
  switch (outcome) {
    case "LOCATION_REJECTED":
      return "location not eligible (not Pakistan/UAE, and not remote-eligible)";
    case "HARD_NEGATIVE_REJECTED":
      return "hard negative title match (help desk/service desk/IT support/sysadmin/etc.)";
    case "NON_SOFTWARE_QA_REJECTED":
      return "non-software-QA role (food/manufacturing/construction/pharma QC, BPO quality analyst, AI data labeling, etc.)";
    case "POSITIVE_CAREER_REJECTED":
      return "insufficient positive QA/testing/automation/AI-quality signal";
  }
}

/** One aggregate summary log per run (Phase 8.5.17 §7) — never per-job volume for this line. */
export function logPreMatchDiagnosticsSummary(diagnostics: PreMatchDiagnostics): void {
  console.log(
    JSON.stringify({
      source: "career-agent",
      stage: "pre_claude_filter_summary",
      locationRejected: diagnostics.locationRejected,
      hardNegativeRejected: diagnostics.hardNegativeRejected,
      nonSoftwareQaRejected: diagnostics.nonSoftwareQaRejected,
      positiveCareerRejected: diagnostics.positiveCareerRejected,
      qualifiedForMatching: diagnostics.qualifiedForMatching,
      byTier: diagnostics.byTier,
      bySource: diagnostics.bySource
    })
  );
}
