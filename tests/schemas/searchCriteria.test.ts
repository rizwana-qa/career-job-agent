import { describe, expect, it } from "vitest";
import { SearchCriteriaSchema } from "../../src/schemas/searchCriteria.js";

describe("SearchCriteriaSchema", () => {
  it("accepts an empty object — every field is optional", () => {
    expect(SearchCriteriaSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a fully populated criteria object", () => {
    const result = SearchCriteriaSchema.safeParse({
      roleKeywords: ["AI Quality Engineer"],
      locations: ["Remote"],
      countries: ["Pakistan", "UAE"],
      remoteOnly: true,
      minimumSalary: 100000,
      employmentTypes: ["FULL_TIME"],
      postedWithinDays: 30,
      experienceLevel: "Principal",
      industries: ["SaaS"],
      excludedKeywords: ["Sales"]
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid employmentType value", () => {
    const result = SearchCriteriaSchema.safeParse({ employmentTypes: ["WEEKEND_ONLY"] });
    expect(result.success).toBe(false);
  });

  it("rejects a negative minimumSalary", () => {
    const result = SearchCriteriaSchema.safeParse({ minimumSalary: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive postedWithinDays", () => {
    const result = SearchCriteriaSchema.safeParse({ postedWithinDays: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects an empty string inside roleKeywords", () => {
    const result = SearchCriteriaSchema.safeParse({ roleKeywords: [""] });
    expect(result.success).toBe(false);
  });
});
