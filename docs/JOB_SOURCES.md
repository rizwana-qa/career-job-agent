# Job Sources — Access Review (Phase 8.4)

This documents, for each target job source, whether a documented/legitimate
public access method exists, and whether it is implementable today without
violating CLAUDE.md rules 12–13 (no unauthorized automation, no CAPTCHA/auth
bypass) or Phase 8.4's explicit instruction not to invent undocumented APIs
or scrape unsupported pages.

**Method**: this review reflects publicly documented, well-established
knowledge about each provider's integration surface. It is not a live check
of these providers' current developer/partner portals (Phase 8.4 explicitly
prohibits any live job-source call for this task). If Indeed, Naukrigulf, or
GulfTalent have since opened a new public API program, that would need to be
confirmed directly against their current developer documentation before any
adapter here is switched from placeholder to live.

## Remotive

| | |
|---|---|
| Access method | Public REST API — `GET https://remotive.com/api/remote-jobs` |
| Available | YES |
| Credential required | NO |
| Implementable now | YES — already implemented (`src/jobSources/remotiveJobSource.ts`), unchanged by Phase 8.4 |

Remotive is the only source with a genuinely open, unauthenticated public
API. Nothing about it changed in this phase.

## Indeed

| | |
|---|---|
| Access method | No general-purpose public job-search API open to new integrations. Indeed's historical Publisher/Job Search API stopped accepting new registrations years ago; current documented integration paths (XML job feed, Indeed Apply sync) are gated behind an approved employer/ATS partnership, not a self-serve API key. |
| Available | NO |
| Credential required | YES (partner approval, not a simple API key) |
| Implementable now | NO |

## Naukrigulf

| | |
|---|---|
| Access method | No documented public job-search API for third-party consumption was found. Naukrigulf's public integrations are recruiter/employer-side (job posting, ATS sync), not a candidate-search API for external applications. |
| Available | NO |
| Credential required | Unknown — likely requires a direct employer/commercial partnership; not confirmed |
| Implementable now | NO |

## GulfTalent

| | |
|---|---|
| Access method | No documented public job-search API for third-party consumption was found. |
| Available | NO |
| Credential required | Unknown — not confirmed |
| Implementable now | NO |

## What exists today for Indeed / Naukrigulf / GulfTalent

Per Phase 8.4's instruction, since none of these three has a documented,
legitimately usable public access method, each gets a placeholder adapter
implementing the `JobSource` interface (`src/jobSources/indeedJobSource.ts`,
`naukrigulfJobSource.ts`, `gulfTalentJobSource.ts`):

- `searchJobs()` throws `JobSourceUnavailableError` with a clear message —
  never an undocumented/scraped call, never a silent no-op.
- `normalize()` is fully implemented against a **documented placeholder raw
  shape** (typical of that provider's historically known JSON conventions),
  so normalization logic and its tests are ready in advance. **This raw
  shape must be verified against the real API once legitimate access is
  obtained** — it is a reasonable placeholder, not a confirmed contract.
- `getJob()` returns `null` (no live per-job lookup implemented).
- Each is gated behind its own `JOB_SOURCE_*_ENABLED` env flag, defaulting
  to disabled (see `src/config/env.ts`). Enabling one without real access
  simply produces a `FAILED` entry in that source's discovery diagnostics —
  it does not crash the run (see `src/services/jobDiscoveryService.ts`'s
  per-source error isolation) and does not affect the other sources.
- Placeholder credential env vars (`INDEED_API_KEY`, `NAUKRIGULF_API_KEY`,
  `GULFTALENT_API_KEY`) are defined in `src/config/env.ts` for when real
  access is obtained. They are read from `process.env` only and are never
  hardcoded or used by anything today.

## Before going live with any of these three

1. Confirm the current, actual documented access method directly against
   the provider's own developer/partner documentation (this review is not a
   substitute for that).
2. Obtain the required credential/partnership through the provider's own
   process — never bypass authentication, CAPTCHA, or platform restrictions.
3. Adjust the adapter's raw-shape types and `normalize()` mapping to match
   the real, confirmed response shape.
4. Replace the `throw new JobSourceUnavailableError(...)` in `searchJobs()`
   with the real, credentialed request, using `src/jobSources/searchConcepts.ts`'s
   centralized `CAREER_SEARCH_CONCEPTS` / `TARGET_SEARCH_LOCATIONS` to build
   a small, bounded query set — not per-keyword fan-out.

---

# Final source stack (Phase 8.5)

Six additional sources, per the project's specified final source strategy.
The four with a genuinely documented, no-credential public API get real,
`fetch()`-capable adapters (mirroring `remotiveJobSource.ts`'s structure);
the two that require a credential this environment doesn't have follow the
same placeholder pattern as Indeed/Naukrigulf/GulfTalent above.

**Important caveat**: no live call was made to any of these six during
implementation (explicitly prohibited for this phase). For the four
"real" adapters, the exact response field names in each `*RawJob`/
`*RawItem` type are this codebase's best-effort, documented understanding
of that provider's public feed — **not yet verified against a live
response**. Treat the first real invocation of each as the moment its raw
shape actually gets confirmed, the same way Phase 6.1 required one
authorized live Claude call before that integration was trusted.

## Himalayas

| | |
|---|---|
| Access method | Public JSON API — `GET https://himalayas.app/jobs/api/search` |
| Available | YES |
| Credential required | NO |
| Implementable now | YES (raw shape unverified — see caveat above) — `src/jobSources/himalayasJobSource.ts` |

Respects the documented ~20-result-per-request limit. `applicationLink` is
used as `sourceUrl`; a job without one is dropped, never reconstructed.

## Remote OK

| | |
|---|---|
| Access method | Public JSON API — `GET https://remoteok.com/api` |
| Available | YES |
| Credential required | NO |
| Implementable now | YES (raw shape unverified — see caveat above) — `src/jobSources/remoteOkJobSource.ts` |

Never scrapes HTML. The feed's own leading non-job legal/notice entry is
naturally dropped by `normalize()`'s required-field checks.

## Careerjet

| | |
|---|---|
| Access method | Documented partner/affiliate Job Search API — `GET http://public-api.careerjet.net/search`, requires an approved affiliate account |
| Available | Partner-gated |
| Credential required | YES — `CAREERJET_API_KEY` + `CAREERJET_AFFILIATE_ID`, not configured in this environment |
| Implementable now | Adapter is real and fetch-capable as of Phase 8.5.15 (`src/jobSources/careerjetJobSource.ts`), but `searchJobs()` still throws `JobSourceAuthError` until real credentials are configured — raw shape unverified, see caveat above |

Phase 8.5.15 added tier-prioritized, bounded multi-query search (mirroring
`himalayasJobSource.ts`), using Careerjet's documented separate
`location`/`locale_code` parameters (not embedded in the keyword text — see
the Himalayas section above for why that approach was abandoned there).
Target locales: Pakistan (`en_PK` — Islamabad, Pakistan) and UAE (`en_AE` —
Dubai, Abu Dhabi, UAE), configurable via `DEFAULT_CAREERJET_TARGET_LOCALES`.
The exact transport mechanism for `CAREERJET_API_KEY` (query param vs
header) is unverified — sent as a best-effort `api_key` query param; confirm
against the real partner API contract before enabling in production.

## Jobicy

| | |
|---|---|
| Access method | Public JSON API — `GET https://jobicy.com/api/v2/remote-jobs` |
| Available | YES |
| Credential required | NO |
| Implementable now | YES (raw shape unverified — see caveat above) — `src/jobSources/jobicyJobSource.ts` |

## Jooble

| | |
|---|---|
| Access method | Documented REST API |
| Available | YES, key-gated |
| Credential required | YES — `JOOBLE_API_KEY`, not configured in this environment |
| Implementable now | NO — placeholder adapter (`src/jobSources/joobleJobSource.ts`) |

## We Work Remotely

| | |
|---|---|
| Access method | Public RSS feed — `GET https://weworkremotely.com/categories/remote-programming-jobs.rss` |
| Available | YES |
| Credential required | NO |
| Implementable now | YES (raw shape unverified — see caveat above) — `src/jobSources/weWorkRemotelyJobSource.ts` |

No authorized API token exists for WWR, so this uses public RSS only, per
the project's explicit instruction. Parsed with a small dependency-free
regex-based extractor (`parseWeWorkRemotelyRss()`) rather than adding an
XML library for one feed.

## Feature flags and defaults

`JOB_SOURCE_HIMALAYAS_ENABLED`, `JOB_SOURCE_REMOTEOK_ENABLED`,
`JOB_SOURCE_CAREERJET_ENABLED`, `JOB_SOURCE_JOBICY_ENABLED`,
`JOB_SOURCE_JOOBLE_ENABLED`, `JOB_SOURCE_WWR_ENABLED` all default to
**false** — including Himalayas/Remote OK/Jobicy/WWR, despite having a
documented no-credential public API. This is deliberately more
conservative than the project's stated "recommended production defaults
after successful integration" table (Himalayas/Remote OK/Careerjet/Remotive
= true). Only `JOB_SOURCE_REMOTIVE_ENABLED` stays at its existing default
(true), since it's the one source already verified live in production.

Flip a flag on only after that source has been verified — e.g. via one
authorized live test per source, the same pattern Phase 6.1 used for the
Claude integration. Every source, once enabled, is isolated by the existing
per-source error handling (`src/services/jobDiscoveryService.ts`): a bad
response or an outage from one source never fails the whole discovery run.
