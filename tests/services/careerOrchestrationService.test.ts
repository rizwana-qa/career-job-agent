import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  runCareerPipeline,
  InMemoryIdempotencyStore,
  type CareerRunDependencies
} from "../../src/services/careerOrchestrationService.js";
import type { JobSource, RawProviderJob } from "../../src/jobSources/jobSource.js";
import type { NotificationProvider } from "../../src/notifications/notificationProvider.js";
import { ClaudeNotConfiguredError, JobSourceUnavailableError } from "../../src/utils/errors.js";

const matchingProfile = {
  professionalTitle: "Principal Software Quality Engineer",
  coreSkills: "Playwright, API Testing, SQL"
};

const resumeProfile = {
  professionalTitle: "Principal Software Quality Engineer | AI, RAG and LLM Testing Specialist",
  ragSkills: "RAG platform testing — retrieval accuracy, hallucination detection, vector database validation",
  achievements: "35 to 40% reduction in production defects; 60% test coverage"
};

const masterResume =
  "Rizwana Zahoor — Principal Quality Assurance Engineer, Clustox. Tested a RAG based AI coaching platform. " +
  "Achieved a 35 to 40% reduction in production defects.";

function rawJob(overrides: Record<string, unknown> = {}): RawProviderJob {
  return {
    jobTitle: "Quality Engineer",
    company: "Remote Co",
    location: "Worldwide",
    country: "Worldwide",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    jobDescription: "A sufficiently long job description mentioning quality engineering and testing responsibilities.",
    requirements: ["Testing experience"],
    responsibilities: ["Test the product"],
    skills: ["Testing", "QA"],
    source: "remotive",
    sourceUrl: "https://remotive.com/remote-jobs/qa/job-1",
    datePosted: "2026-08-10",
    externalJobId: "1",
    ...overrides
  };
}

function fakeJobSource(jobs: RawProviderJob[], searchJobs?: ReturnType<typeof vi.fn>): JobSource {
  return {
    name: "fake-source",
    searchJobs: searchJobs ?? vi.fn(async () => jobs),
    async getJob() {
      return null;
    },
    normalize(raw: RawProviderJob) {
      return raw;
    }
  };
}

function failingJobSource(error: Error): JobSource {
  return {
    name: "fake-source",
    async searchJobs() {
      throw error;
    },
    async getJob() {
      return null;
    },
    normalize(raw: RawProviderJob) {
      return raw;
    }
  };
}

/** Fixed-shape JSON builders — one per Claude-calling stage in the pipeline. */
function matchJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    matchScore: 75,
    interviewPotential: 60,
    careerGrowth: 55,
    futureAIValue: 50,
    recommendation: "CONSIDER",
    strongMatches: [],
    transferableSkills: [],
    gaps: [],
    risks: [],
    reason: "test fixture reason",
    ...overrides
  });
}

function tailoredResumeJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jobId: "placeholder",
    targetRole: "placeholder",
    targetCompany: "placeholder",
    professionalSummary: "Principal QA leader with RAG testing experience.",
    coreSkills: ["Testing"],
    experience: [{ title: "QA Engineer", company: "Clustox", dates: "2022-Present", bullets: ["Did QA work."] }],
    education: [],
    certifications: [],
    matchedRequirements: [],
    transferableRequirements: [],
    gaps: [],
    keywordsAdded: [],
    changesMade: [],
    claimsRequiringVerification: [],
    tailoredResume: "Full tailored resume text.",
    status: "READY_FOR_RESUME_QA",
    ...overrides
  });
}

function evidenceJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: "PASS",
    evidenceScore: 100,
    claimsReviewed: 0,
    supportedClaims: [],
    transferableClaims: [],
    potentiallyUnsupportedClaims: [],
    unsupportedClaims: [],
    unknownClaims: [],
    recommendations: [],
    ...overrides
  });
}

function qaPassJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: "PASS",
    overallScore: 85,
    jdAlignmentScore: 80,
    factualAccuracyScore: 90,
    interviewReadinessScore: 85,
    criticalIssues: [],
    highIssues: [],
    mediumIssues: [],
    lowIssues: [],
    strengths: [],
    mandatoryRequirements: [],
    preferredRequirements: [],
    supportedKeywords: [],
    missingImportantKeywords: [],
    unsupportedKeywords: [],
    overusedKeywords: [],
    unsupportedClaims: [],
    transferableClaims: [],
    recommendations: [],
    humanReviewRequired: false,
    ...overrides
  });
}

function qaFailJson(): string {
  return JSON.stringify({
    status: "FAIL",
    overallScore: 40,
    jdAlignmentScore: 40,
    factualAccuracyScore: 20,
    interviewReadinessScore: 40,
    criticalIssues: [
      { severity: "CRITICAL", dimension: "Factual Accuracy", description: "Fabricated certification.", evidence: "No such cert in Master Resume." }
    ],
    highIssues: [],
    mediumIssues: [],
    lowIssues: [],
    strengths: [],
    mandatoryRequirements: [],
    preferredRequirements: [],
    supportedKeywords: [],
    missingImportantKeywords: [],
    unsupportedKeywords: [],
    overusedKeywords: [],
    unsupportedClaims: [],
    transferableClaims: [],
    recommendations: [],
    humanReviewRequired: true
  });
}

function applicationMessageJson(text = "Thank you for considering my application."): string {
  return JSON.stringify({ applicationMessage: text });
}

/** One full successful job's worth of Claude responses: match, tailor, evidence, QA (pass), application message. */
function fullSuccessSequence(): string[] {
  return [matchJson(), tailoredResumeJson(), evidenceJson(), qaPassJson(), applicationMessageJson()];
}

type QueueItem = string | (() => string);

function queueClaudeClient(items: QueueItem[]): Anthropic {
  let index = 0;
  const create = vi.fn(async () => {
    const item = items[index];
    if (item === undefined) {
      throw new Error(`queueClaudeClient: no mock response queued for call #${index + 1}`);
    }
    index += 1;
    const text = typeof item === "function" ? item() : item;
    return { content: [{ type: "text", text }] };
  });
  return { messages: { create } } as unknown as Anthropic;
}

function nonRetryableFailure(): never {
  throw Object.assign(new Error("Bad Request"), { status: 400 });
}

function mockNotificationProvider(
  impl?: () => Promise<{ success: boolean; providerMessageId?: string; statusDescription: string }>
): NotificationProvider {
  const sendNotification = vi.fn(impl ?? (async () => ({ success: true, providerMessageId: "wamid.1", statusDescription: "delivered" })));
  return { name: "mock-provider", sendNotification };
}

function baseDeps(overrides: Partial<CareerRunDependencies> = {}): CareerRunDependencies {
  return {
    jobSource: fakeJobSource([rawJob()]),
    matchingProfile,
    resumeProfile,
    masterResume,
    jobDiscoveryPreferences: {},
    jobPreferences: {},
    ...overrides
  };
}

describe("runCareerPipeline — successful dry run (default)", () => {
  it("discovers, matches, tailors, QAs, and packages a job without sending WhatsApp", async () => {
    const claudeClient = queueClaudeClient(fullSuccessSequence());
    const notificationProvider = mockNotificationProvider();

    const result = await runCareerPipeline({ options: {} }, baseDeps({ claudeClient, notificationProvider }));

    expect(result.status).toBe("COMPLETED");
    expect(result.dryRun).toBe(true);
    expect(result.jobsDiscovered).toBe(1);
    expect(result.jobsAfterFiltering).toBe(1);
    expect(result.jobsMatched).toBe(1);
    expect(result.applicationPackagesCreated).toBe(1);
    expect(result.whatsappNotificationsSent).toBe(0);
    expect(result.matchingFailures).toEqual({ count: 0, hasFailures: false });
    expect(notificationProvider.sendNotification).not.toHaveBeenCalled();
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(5);
  });
});

describe("runCareerPipeline — successful normal run", () => {
  it("sends a WhatsApp notification when dryRun=false and sendWhatsApp=true", async () => {
    const claudeClient = queueClaudeClient(fullSuccessSequence());
    const notificationProvider = mockNotificationProvider();

    const result = await runCareerPipeline(
      { options: { dryRun: false, sendWhatsApp: true } },
      baseDeps({ claudeClient, notificationProvider })
    );

    expect(result.status).toBe("COMPLETED");
    expect(result.dryRun).toBe(false);
    expect(result.applicationPackagesCreated).toBe(1);
    expect(result.whatsappNotificationsSent).toBe(1);
    expect(notificationProvider.sendNotification).toHaveBeenCalledTimes(1);
  });
});

describe("runCareerPipeline — idempotency", () => {
  it("returns the cached result and never re-runs the pipeline for a repeated Idempotency-Key", async () => {
    const claudeClient = queueClaudeClient(fullSuccessSequence());
    const searchJobs = vi.fn(async () => [rawJob()]);
    const jobSource = fakeJobSource([], searchJobs);
    const idempotencyStore = new InMemoryIdempotencyStore();

    const deps = baseDeps({ claudeClient, jobSource, idempotencyStore });

    const first = await runCareerPipeline({ options: {}, idempotencyKey: "run-abc" }, deps);
    const second = await runCareerPipeline({ options: {}, idempotencyKey: "run-abc" }, deps);

    expect(second).toEqual(first);
    expect(searchJobs).toHaveBeenCalledTimes(1);
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(5);
  });

  it("ignores differing options on a duplicate request and still returns the original cached result", async () => {
    const claudeClient = queueClaudeClient(fullSuccessSequence());
    const searchJobs = vi.fn(async () => [rawJob()]);
    const jobSource = fakeJobSource([], searchJobs);
    const idempotencyStore = new InMemoryIdempotencyStore();
    const notificationProvider = mockNotificationProvider();

    const deps = baseDeps({ claudeClient, jobSource, idempotencyStore, notificationProvider });

    const first = await runCareerPipeline({ options: { dryRun: true }, idempotencyKey: "dup-1" }, deps);
    const second = await runCareerPipeline({ options: { dryRun: false, sendWhatsApp: true }, idempotencyKey: "dup-1" }, deps);

    expect(second.runId).toBe(first.runId);
    expect(second.dryRun).toBe(true); // the cached (first) result's dryRun, not the second request's
    expect(searchJobs).toHaveBeenCalledTimes(1);
    expect(notificationProvider.sendNotification).not.toHaveBeenCalled();
  });
});

describe("runCareerPipeline — empty job results", () => {
  it("returns all-zero counts, status COMPLETED, and never calls Claude", async () => {
    const claudeClient = queueClaudeClient([]);
    const jobSource = fakeJobSource([]);

    const result = await runCareerPipeline({ options: {} }, baseDeps({ claudeClient, jobSource }));

    expect(result.status).toBe("COMPLETED");
    expect(result.jobsDiscovered).toBe(0);
    expect(result.jobsAfterFiltering).toBe(0);
    expect(result.jobsMatched).toBe(0);
    expect(result.topJobs).toEqual([]);
    expect(result.applicationPackagesCreated).toBe(0);
    expect(result.matchingFailures).toEqual({ count: 0, hasFailures: false });
    expect(claudeClient.messages.create).not.toHaveBeenCalled();
  });
});

describe("runCareerPipeline — Job Matching failure visibility (Phase 6.1)", () => {
  it("returns PARTIAL with matchingFailures reported when some jobs match and some fail matching", async () => {
    const jobs = [
      rawJob({ externalJobId: "1", sourceUrl: "https://remotive.com/job-1", jobTitle: "Quality Engineer One" }),
      rawJob({ externalJobId: "2", sourceUrl: "https://remotive.com/job-2", jobTitle: "Quality Engineer Two" })
    ];
    // job 1's match succeeds and goes through the full downstream pipeline;
    // job 2's match call fails outright (never reaches downstream at all).
    const claudeClient = queueClaudeClient([
      matchJson({ matchScore: 90 }), // job 1 match — succeeds
      nonRetryableFailure, // job 2 match — fails, non-retryable
      ...fullSuccessSequence().slice(1) // job 1: tailor, evidence, qa, application message
    ]);
    const jobSource = fakeJobSource(jobs);

    const result = await runCareerPipeline({ options: { topJobs: 2 } }, baseDeps({ claudeClient, jobSource }));

    expect(result.status).toBe("PARTIAL");
    expect(result.jobsDiscovered).toBe(2);
    expect(result.jobsAfterFiltering).toBe(2);
    expect(result.jobsMatched).toBe(1);
    expect(result.matchingFailures).toEqual({ count: 1, hasFailures: true });
    expect(result.applicationPackagesCreated).toBe(1);
  });

  it("returns FAILED with matchingFailures reported when every eligible job fails to match (regression: 12 filtered jobs, 12 matching failures, 0 matched)", async () => {
    const jobs = Array.from({ length: 12 }, (_, i) =>
      rawJob({
        externalJobId: String(i + 1),
        sourceUrl: `https://remotive.com/job-${i + 1}`,
        jobTitle: `Quality Engineer ${i + 1}`
      })
    );
    const claudeClient = queueClaudeClient(jobs.map(() => nonRetryableFailure));
    const jobSource = fakeJobSource(jobs);

    const result = await runCareerPipeline({ options: { maxJobs: 12, topJobs: 12 } }, baseDeps({ claudeClient, jobSource }));

    expect(result.status).toBe("FAILED");
    expect(result.jobsDiscovered).toBe(12);
    expect(result.jobsAfterFiltering).toBe(12);
    expect(result.jobsMatched).toBe(0);
    expect(result.matchingFailures).toEqual({ count: 12, hasFailures: true });
    expect(result.topJobs).toEqual([]);
    expect(result.applicationPackagesCreated).toBe(0);
    // Only the per-job matching call is consumed for each failure — no
    // downstream (tailor/evidence/QA/package) calls happen for a job whose
    // match never succeeded.
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(12);
  });

  it("never exposes raw Claude error text or payloads in matchingFailures", async () => {
    const jobs = [rawJob({ externalJobId: "1", sourceUrl: "https://remotive.com/job-1" })];
    const claudeClient = queueClaudeClient([
      () => {
        throw Object.assign(new Error('400 {"type":"error","error":{"message":"Your credit balance is too low..."}}'), {
          status: 400
        });
      }
    ]);
    const jobSource = fakeJobSource(jobs);

    const result = await runCareerPipeline({ options: {} }, baseDeps({ claudeClient, jobSource }));

    expect(result.status).toBe("FAILED");
    expect(result.matchingFailures).toEqual({ count: 1, hasFailures: true });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("credit balance");
    expect(serialized).not.toContain("type\":\"error\"");
    // matchingFailures must be exactly {count, hasFailures} — no extra keys
    // like an error message, category, or raw payload snuck in.
    expect(Object.keys(result.matchingFailures).sort()).toEqual(["count", "hasFailures"]);
  });
});

describe("runCareerPipeline — partial pipeline failure", () => {
  it("keeps the run PARTIAL and still returns the package for the job that succeeded", async () => {
    const jobs = [
      rawJob({ externalJobId: "1", sourceUrl: "https://remotive.com/job-1", jobTitle: "Quality Engineer One" }),
      rawJob({ externalJobId: "2", sourceUrl: "https://remotive.com/job-2", jobTitle: "Quality Engineer Two" })
    ];
    // Job 1 scores higher so ranking places it first, making the failure land
    // deterministically on job 1's tailoring call regardless of tie-break order.
    const claudeClient = queueClaudeClient([
      matchJson({ matchScore: 90 }), // job 1 match
      matchJson({ matchScore: 60 }), // job 2 match
      nonRetryableFailure, // job 1 tailoring fails (non-retryable -> single call, no retry)
      ...fullSuccessSequence().slice(1) // job 2: tailor, evidence, qa, application message
    ]);
    const jobSource = fakeJobSource(jobs);

    const result = await runCareerPipeline({ options: { topJobs: 2 } }, baseDeps({ claudeClient, jobSource }));

    expect(result.status).toBe("PARTIAL");
    expect(result.jobsDiscovered).toBe(2);
    expect(result.jobsMatched).toBe(2);
    expect(result.applicationPackagesCreated).toBe(1);
    expect(result.topJobs).toHaveLength(1);
  });
});

describe("runCareerPipeline — Claude failure at discovery", () => {
  it("returns status FAILED without throwing when no Claude client is available but jobs exist", async () => {
    const result = await runCareerPipeline({ options: {} }, baseDeps({ claudeClient: undefined }));

    expect(result.status).toBe("FAILED");
    expect(result.jobsDiscovered).toBe(0);
    expect(result.topJobs).toEqual([]);
    expect(result.applicationPackagesCreated).toBe(0);
  });

  it("the underlying discovery call does in fact throw ClaudeNotConfiguredError (sanity check on the fixture)", async () => {
    const { discoverJobs } = await import("../../src/services/jobDiscoveryService.js");
    await expect(
      discoverJobs({}, { jobSource: fakeJobSource([rawJob()]), profile: matchingProfile, jobDiscoveryPreferences: {} })
    ).rejects.toBeInstanceOf(ClaudeNotConfiguredError);
  });
});

describe("runCareerPipeline — job provider failure", () => {
  it("returns status FAILED without throwing when the job source itself fails", async () => {
    const jobSource = failingJobSource(new JobSourceUnavailableError("simulated outage"));
    const claudeClient = queueClaudeClient([]);

    const result = await runCareerPipeline({ options: {} }, baseDeps({ claudeClient, jobSource }));

    expect(result.status).toBe("FAILED");
    expect(result.jobsDiscovered).toBe(0);
    expect(claudeClient.messages.create).not.toHaveBeenCalled();
  });
});

describe("runCareerPipeline — WhatsApp failure never destroys the job analysis result", () => {
  it("returns PARTIAL with the application package intact when the notification provider throws", async () => {
    const claudeClient = queueClaudeClient(fullSuccessSequence());
    const notificationProvider = mockNotificationProvider(async () => {
      throw new Error("simulated WhatsApp outage");
    });

    const result = await runCareerPipeline(
      { options: { dryRun: false, sendWhatsApp: true } },
      baseDeps({ claudeClient, notificationProvider })
    );

    expect(result.status).toBe("PARTIAL");
    expect(result.applicationPackagesCreated).toBe(1);
    expect(result.whatsappNotificationsSent).toBe(0);
  });
});

describe("runCareerPipeline — Resume QA failure", () => {
  it("records a FAILED application package result without crashing the run, and never calls Claude for the application message", async () => {
    const claudeClient = queueClaudeClient([matchJson(), tailoredResumeJson(), evidenceJson(), qaFailJson()]);

    const result = await runCareerPipeline({ options: {} }, baseDeps({ claudeClient }));

    expect(result.status).toBe("COMPLETED"); // a QA FAIL is a normal outcome, not a thrown per-job error
    expect(result.applicationPackagesCreated).toBe(0);
    expect(result.topJobs).toHaveLength(1);
    expect(result.topJobs[0].applicationStatus).toBe("FAILED");
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(4);
  });
});

describe("runCareerPipeline — default dryRun behavior", () => {
  it("stays dryRun=true (and never sends WhatsApp) even when sendWhatsApp=true and dryRun is omitted", async () => {
    const claudeClient = queueClaudeClient(fullSuccessSequence());
    const notificationProvider = mockNotificationProvider();

    const result = await runCareerPipeline({ options: { sendWhatsApp: true } }, baseDeps({ claudeClient, notificationProvider }));

    expect(result.dryRun).toBe(true);
    expect(result.whatsappNotificationsSent).toBe(0);
    expect(notificationProvider.sendNotification).not.toHaveBeenCalled();
  });
});

describe("runCareerPipeline — WhatsApp disabled by default", () => {
  it("never sends WhatsApp when sendWhatsApp is omitted, even with dryRun=false", async () => {
    const claudeClient = queueClaudeClient(fullSuccessSequence());
    const notificationProvider = mockNotificationProvider();

    const result = await runCareerPipeline({ options: { dryRun: false } }, baseDeps({ claudeClient, notificationProvider }));

    expect(result.whatsappNotificationsSent).toBe(0);
    expect(notificationProvider.sendNotification).not.toHaveBeenCalled();
  });
});

describe("runCareerPipeline — sensitive information is never exposed in the result", () => {
  it("never includes resume text, master resume content, or career profile fields in the returned result", async () => {
    const claudeClient = queueClaudeClient(fullSuccessSequence());

    const result = await runCareerPipeline({ options: {} }, baseDeps({ claudeClient }));

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Full tailored resume text");
    expect(serialized).not.toContain(masterResume);
    expect(serialized).not.toContain(resumeProfile.achievements);
    expect(serialized).not.toContain("Thank you for considering my application");
  });
});
