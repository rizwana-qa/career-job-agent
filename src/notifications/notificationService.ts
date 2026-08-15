import type { ApplicationPackage, ApplicationPackageResult } from "../schemas/applicationPackage.js";
import type { NotificationProvider, NotificationResult } from "./notificationProvider.js";
import { buildWhatsAppMessage } from "./whatsappMessageBuilder.js";

export interface NotifyTopOpportunitiesInput {
  /** The full, mixed set of package results (PASS/FAIL/REVIEW_REQUIRED) for this run's top jobs. */
  packageResults: ApplicationPackageResult[];
}

export interface NotifyTopOpportunitiesDependencies {
  provider: NotificationProvider;
}

export interface NotifyTopOpportunitiesResult {
  /** How many of the input results actually reached READY_FOR_REVIEW — only these are ever mentioned in the notification. */
  packagesEligible: number;
  /** False when there was nothing eligible to report — no notification is sent in that case. */
  notificationSent: boolean;
  providerResult?: NotificationResult;
}

function isReadyForReview(result: ApplicationPackageResult): result is ApplicationPackage {
  return result.status === "READY_FOR_REVIEW";
}

/**
 * Phase 7 orchestration: filters to only the packages that reached
 * READY_FOR_REVIEW (Resume QA PASS), builds the deterministic WhatsApp
 * digest, and sends it. A FAILED or HUMAN_REVIEW_REQUIRED result is never
 * mentioned in the notification — per the Phase 7 spec's "do not send
 * failed applications" rule, enforced here by construction rather than by
 * inspecting each result's status ad hoc at every call site.
 */
export async function notifyTopOpportunities(
  input: NotifyTopOpportunitiesInput,
  deps: NotifyTopOpportunitiesDependencies
): Promise<NotifyTopOpportunitiesResult> {
  const readyPackages = input.packageResults.filter(isReadyForReview);

  if (readyPackages.length === 0) {
    return { packagesEligible: 0, notificationSent: false };
  }

  const text = buildWhatsAppMessage(readyPackages);
  const providerResult = await deps.provider.sendNotification({ text });

  return {
    packagesEligible: readyPackages.length,
    notificationSent: providerResult.success,
    providerResult
  };
}
