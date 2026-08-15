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
