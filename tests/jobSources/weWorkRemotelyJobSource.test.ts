import { describe, expect, it, vi } from "vitest";
import {
  createWeWorkRemotelyJobSource,
  normalizeWeWorkRemotelyJob,
  parseWeWorkRemotelyRss,
  type WeWorkRemotelyRawItem
} from "../../src/jobSources/weWorkRemotelyJobSource.js";
import { InvalidJobSourceResponseError, JobSourceError, JobSourceTimeoutError, JobSourceUnavailableError } from "../../src/utils/errors.js";

function textResponse(body: string, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
}

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>We Work Remotely</title>
<item>
<title>Solace AI: Senior QA Engineer</title>
<link>https://weworkremotely.com/remote-jobs/solace-ai-senior-qa-engineer</link>
<pubDate>Mon, 10 Aug 2026 00:00:00 +0000</pubDate>
<guid>https://weworkremotely.com/remote-jobs/solace-ai-senior-qa-engineer</guid>
<description><![CDATA[<p>Own quality engineering and test automation for our platform, including API testing and Playwright suites.</p>]]></description>
</item>
<item>
<title>Bad Item With No Colon</title>
<link>https://weworkremotely.com/remote-jobs/bad-item</link>
<pubDate>Mon, 10 Aug 2026 00:00:00 +0000</pubDate>
<description><![CDATA[<p>Some description text that is long enough to pass validation easily.</p>]]></description>
</item>
</channel>
</rss>`;

function rawItem(overrides: Partial<WeWorkRemotelyRawItem> = {}): WeWorkRemotelyRawItem {
  return {
    title: "Solace AI: Senior QA Engineer",
    link: "https://weworkremotely.com/remote-jobs/solace-ai-senior-qa-engineer",
    pubDate: "Mon, 10 Aug 2026 00:00:00 +0000",
    guid: "https://weworkremotely.com/remote-jobs/solace-ai-senior-qa-engineer",
    description: "<p>Own quality engineering and test automation for our platform, including API testing.</p>",
    ...overrides
  };
}

describe("parseWeWorkRemotelyRss", () => {
  it("extracts every <item> block into a raw item object", () => {
    const items = parseWeWorkRemotelyRss(SAMPLE_RSS);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Solace AI: Senior QA Engineer");
    expect(items[0].link).toBe("https://weworkremotely.com/remote-jobs/solace-ai-senior-qa-engineer");
  });

  it("decodes CDATA-wrapped descriptions", () => {
    const items = parseWeWorkRemotelyRss(SAMPLE_RSS);
    expect(items[0].description).toContain("Own quality engineering");
    expect(items[0].description).not.toContain("CDATA");
  });

  it("returns an empty array for a feed with no items", () => {
    expect(parseWeWorkRemotelyRss("<rss><channel></channel></rss>")).toEqual([]);
  });
});

describe("normalizeWeWorkRemotelyJob", () => {
  it("normalizes a well-formed item into the common Job shape, splitting 'Company: Title' on the first colon", () => {
    const normalized = normalizeWeWorkRemotelyJob(rawItem()) as Record<string, unknown>;
    expect(normalized).toMatchObject({
      jobTitle: "Senior QA Engineer",
      company: "Solace AI",
      remoteStatus: "REMOTE",
      source: "weworkremotely",
      sourceUrl: "https://weworkremotely.com/remote-jobs/solace-ai-senior-qa-engineer",
      datePosted: "2026-08-10",
      externalJobId: "https://weworkremotely.com/remote-jobs/solace-ai-senior-qa-engineer"
    });
  });

  it("strips HTML from the description", () => {
    const normalized = normalizeWeWorkRemotelyJob(rawItem()) as Record<string, unknown>;
    expect(normalized.jobDescription).not.toContain("<p>");
  });

  it("returns null when the title has no 'Company: Title' separator", () => {
    expect(normalizeWeWorkRemotelyJob(rawItem({ title: "Bad Item With No Colon" }))).toBeNull();
  });

  it("returns null when link is missing — never fabricates a URL", () => {
    expect(normalizeWeWorkRemotelyJob(rawItem({ link: undefined }))).toBeNull();
  });

  it("returns null when the description is too short after stripping HTML", () => {
    expect(normalizeWeWorkRemotelyJob(rawItem({ description: "<p>short</p>" }))).toBeNull();
  });
});

describe("createWeWorkRemotelyJobSource — searchJobs", () => {
  it("fetches the documented public RSS feed and parses it into raw items", async () => {
    const fetchImpl = vi.fn(async () => textResponse(SAMPLE_RSS));
    const source = createWeWorkRemotelyJobSource({ fetchImpl });

    const jobs = await source.searchJobs({});
    expect(jobs).toHaveLength(2);
    expect((fetchImpl.mock.calls[0][0] as string).toString()).toContain("weworkremotely.com");
    expect((fetchImpl.mock.calls[0][0] as string).toString()).toContain(".rss");
  });

  it("throws JobSourceTimeoutError when the request aborts", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    await expect(createWeWorkRemotelyJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceTimeoutError);
  });

  it("throws JobSourceUnavailableError on a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(createWeWorkRemotelyJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceUnavailableError);
  });

  it("throws a generic JobSourceError on a non-OK status", async () => {
    const fetchImpl = vi.fn(async () => textResponse("", 500));
    await expect(createWeWorkRemotelyJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(JobSourceError);
  });

  it("throws InvalidJobSourceResponseError when the response doesn't look like RSS", async () => {
    const fetchImpl = vi.fn(async () => textResponse("<html><body>not rss</body></html>"));
    await expect(createWeWorkRemotelyJobSource({ fetchImpl }).searchJobs({})).rejects.toBeInstanceOf(InvalidJobSourceResponseError);
  });
});

describe("createWeWorkRemotelyJobSource.normalize / getJob", () => {
  it("normalize() delegates to normalizeWeWorkRemotelyJob", () => {
    const source = createWeWorkRemotelyJobSource();
    expect((source.normalize(rawItem()) as Record<string, unknown>).source).toBe("weworkremotely");
  });

  it("getJob always returns null (RSS is search-only)", async () => {
    await expect(createWeWorkRemotelyJobSource().getJob("anything")).resolves.toBeNull();
  });
});
