import { describe, expect, it, vi } from "vitest";
import { notifyTopOpportunities } from "../../src/notifications/notificationService.js";
import { ApplicationPackageSchema, type ApplicationPackageResult } from "../../src/schemas/applicationPackage.js";
import { TailoredResumeSchema } from "../../src/schemas/tailoredResume.js";
import type { NotificationProvider } from "../../src/notifications/notificationProvider.js";

function tailoredResume() {
  return TailoredResumeSchema.parse({
    jobId: "job-1",
    targetRole: "AI Quality Engineer",
    targetCompany: "Vantage AI",
    professionalSummary: "Principal QA leader with RAG testing experience.",
    coreSkills: ["RAG Testing"],
    experience: [{ title: "Principal QA Engineer", company: "Clustox", dates: "2022-Present", bullets: ["Tested RAG platform."] }],
    education: [],
    certifications: [],
    matchedRequirements: [],
    transferableRequirements: [],
    gaps: [],
    keywordsAdded: [],
    changesMade: [],
    claimsRequiringVerification: [],
    tailoredResume: "Full tailored resume text.",
    status: "READY_FOR_RESUME_QA"
  });
}

function readyPackage(overrides: Record<string, unknown> = {}) {
  return ApplicationPackageSchema.parse({
    applicationId: "app-1",
    status: "READY_FOR_REVIEW",
    jobId: "job-1",
    company: "Vantage AI",
    role: "AI Quality Engineer",
    source: "remotive",
    sourceUrl: "https://remotive.com/remote-jobs/qa/job-1",
    matchScore: 82,
    resumeVersion: "AI_QUALITY_ENGINEER_VANTAGE_AI_20260815",
    qaStatus: "PASS",
    applicationStatus: "READY_FOR_REVIEW",
    job: {
      jobTitle: "AI Quality Engineer",
      company: "Vantage AI",
      location: "Worldwide",
      country: "Worldwide",
      remoteStatus: "REMOTE",
      sourceUrl: "https://remotive.com/remote-jobs/qa/job-1",
      salary: "UNKNOWN",
      currency: "UNKNOWN"
    },
    jobMatch: {
      matchScore: 82,
      matchScoreLabel: "Estimated Application Match Score",
      interviewPotential: 70,
      careerGrowth: 65,
      strongMatches: [],
      transferableSkills: [],
      gaps: []
    },
    resume: { ...tailoredResume(), resumeVersion: "AI_QUALITY_ENGINEER_VANTAGE_AI_20260815" },
    resumeQA: { status: "PASS", jdAlignmentScore: 80, factualAccuracyScore: 95, interviewReadinessScore: 82, importantKeywords: [], missingKeywords: [] },
    applicationMessage: "A drafted outreach message.",
    applicationMessageUnsupportedClaims: [],
    createdAt: "2026-08-15T00:00:00.000Z",
    ...overrides
  });
}

function failedResult(overrides: Record<string, unknown> = {}): ApplicationPackageResult {
  return {
    status: "FAILED",
    jobId: "job-2",
    qaStatus: "FAIL",
    reason: "Resume QA returned FAIL — the application package cannot be generated.",
    criticalIssueSummaries: ["Fabricated certification."],
    ...overrides
  } as ApplicationPackageResult;
}

function reviewRequiredResult(overrides: Record<string, unknown> = {}): ApplicationPackageResult {
  return {
    status: "HUMAN_REVIEW_REQUIRED",
    jobId: "job-3",
    qaStatus: "REVIEW_REQUIRED",
    reason: "Resume QA requires human review before an application package can be generated.",
    ...overrides
  } as ApplicationPackageResult;
}

function mockProvider(impl?: (msg: { text: string }) => Promise<{ success: boolean; providerMessageId?: string; statusDescription: string }>): NotificationProvider {
  const sendNotification = vi.fn(impl ?? (async () => ({ success: true, providerMessageId: "wamid.1", statusDescription: "delivered" })));
  return { name: "mock-provider", sendNotification };
}

describe("notifyTopOpportunities — Resume QA failure is excluded", () => {
  it("does not mention a FAILED (Resume QA FAIL) result in the notification", async () => {
    const provider = mockProvider();
    const result = await notifyTopOpportunities({ packageResults: [readyPackage(), failedResult()] }, { provider });

    expect(result.packagesEligible).toBe(1);
    expect(provider.sendNotification).toHaveBeenCalledTimes(1);
    const sentText = (provider.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
    expect(sentText).not.toContain("job-2");
    expect(sentText).not.toContain("Fabricated certification");
  });

  it("sends nothing at all when every result is FAILED", async () => {
    const provider = mockProvider();
    const result = await notifyTopOpportunities({ packageResults: [failedResult(), failedResult({ jobId: "job-9" })] }, { provider });

    expect(result.packagesEligible).toBe(0);
    expect(result.notificationSent).toBe(false);
    expect(provider.sendNotification).not.toHaveBeenCalled();
  });
});

describe("notifyTopOpportunities — Application Package failure (REVIEW_REQUIRED) is excluded", () => {
  it("does not mention a HUMAN_REVIEW_REQUIRED result in the notification", async () => {
    const provider = mockProvider();
    const result = await notifyTopOpportunities({ packageResults: [readyPackage(), reviewRequiredResult()] }, { provider });

    expect(result.packagesEligible).toBe(1);
    const sentText = (provider.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
    expect(sentText).not.toContain("job-3");
  });

  it("sends nothing when the only result is HUMAN_REVIEW_REQUIRED", async () => {
    const provider = mockProvider();
    const result = await notifyTopOpportunities({ packageResults: [reviewRequiredResult()] }, { provider });

    expect(result.notificationSent).toBe(false);
    expect(provider.sendNotification).not.toHaveBeenCalled();
  });
});

describe("notifyTopOpportunities — empty job list", () => {
  it("sends nothing for an empty package-results array", async () => {
    const provider = mockProvider();
    const result = await notifyTopOpportunities({ packageResults: [] }, { provider });

    expect(result.packagesEligible).toBe(0);
    expect(result.notificationSent).toBe(false);
    expect(provider.sendNotification).not.toHaveBeenCalled();
  });
});

describe("notifyTopOpportunities — provider failure", () => {
  it("propagates a thrown provider error rather than silently swallowing it", async () => {
    const provider = mockProvider(async () => {
      throw new Error("simulated provider outage");
    });

    await expect(notifyTopOpportunities({ packageResults: [readyPackage()] }, { provider })).rejects.toThrow(
      "simulated provider outage"
    );
  });

  it("reports notificationSent: false when the provider itself reports failure without throwing", async () => {
    const provider = mockProvider(async () => ({ success: false, statusDescription: "rejected by provider" }));
    const result = await notifyTopOpportunities({ packageResults: [readyPackage()] }, { provider });

    expect(result.notificationSent).toBe(false);
    expect(result.providerResult?.statusDescription).toBe("rejected by provider");
  });
});

describe("notifyTopOpportunities — successful multi-job notification", () => {
  it("sends one message covering all ready packages and reports the count", async () => {
    const provider = mockProvider();
    const result = await notifyTopOpportunities(
      { packageResults: [readyPackage({ jobId: "1" }), readyPackage({ jobId: "2" }), readyPackage({ jobId: "3" })] },
      { provider }
    );

    expect(result.packagesEligible).toBe(3);
    expect(result.notificationSent).toBe(true);
    expect(provider.sendNotification).toHaveBeenCalledTimes(1);
    const sentText = (provider.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
    expect(sentText).toContain("3 opportunities found");
  });
});
