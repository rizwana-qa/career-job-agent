import { describe, expect, it } from "vitest";
import { CareerRunOptionsSchema, CareerRunResultSchema } from "../../src/schemas/careerRun.js";

describe("CareerRunOptionsSchema — defaults (Phase 8 spec §2-3)", () => {
  it("applies maxJobs=20, topJobs=5, sendWhatsApp=false, dryRun=true when no options are supplied", () => {
    const result = CareerRunOptionsSchema.parse({});
    expect(result).toEqual({ maxJobs: 20, topJobs: 5, sendWhatsApp: false, dryRun: true });
  });

  it("defaults dryRun to true even when other fields are explicitly set", () => {
    const result = CareerRunOptionsSchema.parse({ maxJobs: 10, topJobs: 3 });
    expect(result.dryRun).toBe(true);
    expect(result.sendWhatsApp).toBe(false);
  });

  it("accepts an explicit override of every field", () => {
    const result = CareerRunOptionsSchema.parse({ maxJobs: 5, topJobs: 2, sendWhatsApp: true, dryRun: false });
    expect(result).toEqual({ maxJobs: 5, topJobs: 2, sendWhatsApp: true, dryRun: false });
  });
});

describe("CareerRunOptionsSchema — validation limits", () => {
  it("rejects a maxJobs above 200", () => {
    expect(CareerRunOptionsSchema.safeParse({ maxJobs: 201 }).success).toBe(false);
  });

  it("rejects a topJobs above 50", () => {
    expect(CareerRunOptionsSchema.safeParse({ topJobs: 51 }).success).toBe(false);
  });

  it("rejects a non-positive maxJobs", () => {
    expect(CareerRunOptionsSchema.safeParse({ maxJobs: 0 }).success).toBe(false);
  });

  it("rejects a non-boolean dryRun", () => {
    expect(CareerRunOptionsSchema.safeParse({ dryRun: "true" }).success).toBe(false);
  });

  it("rejects a non-integer topJobs", () => {
    expect(CareerRunOptionsSchema.safeParse({ topJobs: 2.5 }).success).toBe(false);
  });
});

describe("CareerRunResultSchema", () => {
  it("validates a well-formed COMPLETED dry-run result", () => {
    const result = CareerRunResultSchema.safeParse({
      runId: "11111111-1111-1111-1111-111111111111",
      status: "COMPLETED",
      jobsDiscovered: 10,
      jobsAfterFiltering: 4,
      jobsMatched: 4,
      topJobs: [
        {
          role: "AI Quality Engineer",
          company: "Vantage AI",
          sourceUrl: "https://remotive.com/remote-jobs/qa/1",
          matchScore: 82,
          careerScore: 78,
          classification: "HIGH_PRIORITY",
          applicationStatus: "READY_FOR_REVIEW"
        }
      ],
      applicationPackagesCreated: 1,
      whatsappNotificationsSent: 0,
      matchingFailures: { count: 0, hasFailures: false },
      dryRun: true,
      startedAt: "2026-08-15T00:00:00.000Z",
      completedAt: "2026-08-15T00:00:05.000Z"
    });

    expect(result.success).toBe(true);
  });

  it("rejects a result missing matchingFailures", () => {
    const result = CareerRunResultSchema.safeParse({
      runId: "11111111-1111-1111-1111-111111111111",
      status: "COMPLETED",
      jobsDiscovered: 0,
      jobsAfterFiltering: 0,
      jobsMatched: 0,
      topJobs: [],
      applicationPackagesCreated: 0,
      whatsappNotificationsSent: 0,
      dryRun: true,
      startedAt: "x",
      completedAt: "x"
    });

    expect(result.success).toBe(false);
  });

  it("validates matchingFailures with count and hasFailures", () => {
    const result = CareerRunResultSchema.safeParse({
      runId: "x",
      status: "FAILED",
      jobsDiscovered: 12,
      jobsAfterFiltering: 12,
      jobsMatched: 0,
      topJobs: [],
      applicationPackagesCreated: 0,
      whatsappNotificationsSent: 0,
      matchingFailures: { count: 12, hasFailures: true },
      dryRun: true,
      startedAt: "x",
      completedAt: "x"
    });

    expect(result.success).toBe(true);
  });

  it("rejects a result with an unknown status value", () => {
    const result = CareerRunResultSchema.safeParse({
      runId: "x",
      status: "IN_PROGRESS",
      jobsDiscovered: 0,
      jobsAfterFiltering: 0,
      jobsMatched: 0,
      topJobs: [],
      applicationPackagesCreated: 0,
      whatsappNotificationsSent: 0,
      dryRun: true,
      startedAt: "x",
      completedAt: "x"
    });

    expect(result.success).toBe(false);
  });
});
