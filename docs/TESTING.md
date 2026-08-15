# Testing

## Current coverage (Phase 2: Job Source + Job Matching)

- `tests/health.test.ts` — the app starts and `GET /health` returns
  `{ status: "ok", service: "career-job-agent" }`.
- `tests/schemas/job.test.ts`, `tests/schemas/jobMatch.test.ts` — Zod schema
  validation against both fixture data and deliberately malformed input.
- `tests/services/jobSourceService.test.ts` — raw job array validation,
  including partial-batch failure (one bad job doesn't reject the whole array).
- `tests/services/jobFilterService.test.ts` — deduplication, location
  filtering, junior-role filtering, unrelated-role filtering, salary-floor
  filtering, and the explicit rule that a missing *preferred* qualification
  never causes a rejection at this layer.
- `tests/services/profileService.test.ts` — the career-profile markdown
  parser, including stripping unfilled `[ADD YOUR INFORMATION]` sections.
- `tests/agents/jobMatchingAgent.test.ts` — the Claude job-matching agent,
  with the Claude client fully mocked: valid response parsing, invalid JSON,
  schema-invalid JSON, retry-then-succeed, retry-exhausted, and
  non-retryable-error paths.
- `tests/ranking/jobRanking.test.ts` — every classification boundary
  (90/89/80/79/70/69/60/59), weighted scoring with and without a disclosed
  salary, and top-N selection/ordering.
- `tests/services/jobAnalysisService.test.ts` — the full pipeline
  orchestration with a mocked Claude client: empty input, mixed
  valid/invalid/filtered jobs, partial Claude failures, and the
  Claude-not-required-when-nothing-is-eligible path.
- `tests/api/jobsAnalyze.test.ts` — `POST /jobs/analyze` end-to-end via
  Supertest with an injected mock Claude client: success shape, empty input,
  invalid body (400), and Claude-not-configured (503).

All of the above run against **mocked** Claude responses. No automated test
makes a real Claude API call.

## Current coverage (Phase 3: Resume Tailoring)

- `tests/schemas/tailoredResume.test.ts` — the tailored-resume Zod schema:
  valid shape, empty `tailoredResume` (the "empty resume" case), invalid
  `matchType`, an experience entry with no bullets, and required-field
  omission.
- `tests/services/profileService.test.ts` (additions) — `loadMasterResume`
  / `extractMasterResumeContent` (strips the instructional blockquote,
  detects the unfilled `[PASTE MASTER RESUME HERE]` placeholder),
  `pickResumeRelevantProfileFields` / `loadCareerProfileForResumeTailoring`
  (the broader field set including Achievements/Certifications/Education),
  and `loadResumeRelevantJobPreferences` (Target Roles only).
- `tests/agents/resumeTailoringAgent.test.ts` — same shape of coverage as
  the job matching agent: valid parse, invalid JSON, schema-invalid
  response, retry-then-succeed, retry-exhausted, non-retryable error.
- `tests/services/resumeTailoringService.test.ts` — the full scenario list
  from the Phase 3 spec: normal/AI-focused/automation-focused/leadership-
  focused JDs, missing JD/master resume/career profile, invalid Claude
  JSON, schema validation failure, the empty-resume case, a very long JD,
  and the deterministic hallucination safety nets (unsupported technology,
  unsupported certification) — plus two tests that explicitly document a
  **known limitation**: a hallucinated metric or job responsibility
  embedded in free text is *not* caught by this code layer (see
  `docs/AGENTS.md` → Resume Tailoring Agent for why).

## Current coverage (Phase 3.1: Resume Evidence Guard)

- `tests/schemas/resumeEvidence.test.ts` — the evidence-report Zod schema:
  valid shape, invalid status/classification, empty `evidence` field,
  all-buckets-empty, required-field omission.
- `tests/agents/resumeEvidenceAgent.test.ts` — same coverage shape as the
  other agents: valid parse, invalid JSON, schema-invalid response,
  retry-then-succeed, retry-exhausted, non-retryable error.
- `tests/services/resumeEvidenceService.test.ts` — all 10 named scenarios
  (fully supported resume, invented metric/responsibility/technology/
  certification, transferable skill, reworded legitimate achievement,
  stronger wording that changes meaning, unsupported AI experience,
  unsupported leadership claim) plus input validation and three
  deterministic-recomputation tests: `evidenceScore`/`claimsReviewed` are
  never trusted from Claude, a claim is re-bucketed by its own
  `classification` field even if Claude misplaced it, and the zero-claims
  edge case (`evidenceScore: 100`, `status: "PASS"`).

## Current coverage (Phase 4: Independent Resume QA)

- `tests/schemas/resumeQA.test.ts` — the QA-report Zod schema: valid shape,
  invalid status/severity/matchType/classification, required-field
  omission, and the `JD_ALIGNMENT_SCORE_LABEL` constant.
- `tests/agents/resumeQAAgent.test.ts` — same coverage shape as the other
  three agents.
- `tests/services/resumeQAService.test.ts` — all 20 named scenarios
  (excellent resume, poor JD alignment, missing mandatory requirement,
  unsupported technology/certification/metric/responsibility/AI-experience/
  leadership-claim, Evidence Guard conflict, keyword stuffing, missing
  keyword, seniority mismatch, repetitive resume, invalid Claude JSON,
  schema validation failure, empty resume/JD, missing career profile/master
  resume) plus dedicated tests for the deterministic decision-enforcement
  rules: a `CRITICAL` issue forces `FAIL` even if Claude self-reported
  `PASS`; a `HIGH` issue never lets `humanReviewRequired` be `false`; an
  issue is re-bucketed by its own `severity` field even if Claude placed it
  in the wrong array; and that Claude's own `REVIEW_REQUIRED`/`FAIL`
  judgment is respected when it isn't contradicted by the hard rules.

## Current coverage (Phase 5: Application Package)

- `tests/services/applicationPackageService.test.ts` — all 14 named
  scenarios (valid PASS package, Resume QA FAIL, Resume QA
  REVIEW_REQUIRED, missing tailored resume/job/job-match, invalid
  job/QA result, unsupported claim in the generated message, application
  message generation, invalid Claude response, schema validation failure,
  master-resume-immutability, `applicationStatus === "READY_FOR_REVIEW"`,
  and a schema-level test proving `"APPLIED"` is structurally rejected)
  plus retry/timeout/non-retryable-error coverage for the message step and
  three `generateResumeVersion()` unit tests (deterministic
  `ROLE_COMPANY_DATE` format, stability, and slug sanitization). There is
  no separate agent-level test file for this phase — the one Claude call
  lives directly in the service (see `docs/AGENTS.md` → Application
  Package), so its retry/parse behavior is tested through the service.

## Current coverage (Phase 6: Job Discovery)

- `tests/schemas/searchCriteria.test.ts` — the search-criteria schema.
- `tests/jobSources/remotiveNormalizer.test.ts` — normalization: schema
  validity, HTML stripping, remoteStatus always REMOTE, source URL and
  externalJobId preservation, salary parsing (clean range → average+USD,
  non-numeric text → UNKNOWN), employment-type mapping (unrecognized →
  `null`, not guessed), missing/short description → `null`, country
  derivation, and the shared-chunk requirements/responsibilities design.
- `tests/jobSources/remotiveJobSource.test.ts` — provider configuration,
  successful discovery, one-call-per-search (never one per role keyword),
  throttle/cache behavior, empty result, and the full error family
  (timeout, auth 401/403, rate limit 429, network failure, non-OK status,
  invalid JSON, unexpected shape) — all via an injected `fetchImpl`, no
  real network call.
- `tests/services/jobDeduplicationService.test.ts` — externalJobId
  namespaced by source, composite fallback, no false merges.
- `tests/services/jobFilterService.test.ts` (additions) — the two new
  `rolesToAvoid`/`excludedIndustries` checks, and a backward-compatibility
  test proving Phase 2 behavior is unchanged when they're omitted.
- `tests/services/profileService.test.ts` (additions) —
  `loadJobDiscoveryPreferences()` against a fully-filled fixture, against
  the real (currently placeholder-heavy) file, and the comma-separated
  prose fallback.
- `tests/services/jobDiscoveryService.test.ts` — the full pipeline via a
  fake in-memory `JobSource`: successful discovery, empty result,
  normalization failures, validation failures, deduplication,
  location/role/remote/salary/roles-to-avoid filtering, recency filtering,
  integration with the real (unmodified) Phase 2 matching/ranking, top-5
  selection, default vs. caller-overridden role keywords, and invalid
  criteria.
- `tests/api/jobsDiscover.test.ts` — `POST /jobs/discover` end-to-end:
  success shape, missing `criteria`, invalid criteria (400), empty result
  without Claude, Claude-not-configured (503), job-source failure (502).

## Manual Claude integration tests

Five scripts make real, billable Claude API calls. None runs during
`npm test` — all are excluded from Vitest's test glob by naming
(`.manual.ts`, not `.test.ts`).

**Job matching** — `tests/integration/claude.manual.ts`:
```bash
# 1. Set a real key in .env (see .env.example)
# 2. Run:
npm run test:claude
```

**Resume tailoring** — `tests/integration/resumeTailoring.manual.ts`:
```bash
npm run test:claude:resume
```

**Resume QA** — `tests/integration/resumeQA.manual.ts` (runs the full
tailoring → evidence guard → QA chain against one fixture job):
```bash
npm run test:claude:resume-qa
```

**Application Package** — `tests/integration/applicationPackage.manual.ts`
(runs the full job match → tailoring → evidence guard → QA → package chain
against one fixture job):
```bash
npm run test:claude:application
```

All resume-related scripts require `profile/master_resume.md` and
`profile/career_profile.md` to have real content (not the unfilled
placeholders), and only print summary fields to the console — status,
scores, issue counts, message length — never the full resume, profile, or
personal contact information.

All scripts exit early with a clear message (exit code 1) if
`CLAUDE_API_KEY` isn't set.

## Manual live-provider test

`tests/integration/jobsLive.manual.ts` performs one small, controlled,
read-only search against the real Remotive API (no key required for this
provider) and prints up to 5 normalized results:

```bash
npm run test:jobs:live
```

Never modifies any state, never calls Claude, and reuses the same
throttle/cache as production — running it twice in quick succession
reuses the cached result rather than making a second live call. Fails
gracefully (non-zero exit, no stack trace dump) on any network/provider
error, consistent with the other manual scripts.

## Current coverage (Phase 7: WhatsApp Notifications)

- `tests/notifications/whatsappMessageBuilder.test.ts` — message
  generation, top-job formatting (role/company/location/remote/scores),
  evidence bullets capped at 3, salary (real figure vs. `UNKNOWN`, never
  fabricated), defensive fallbacks for empty location/company/role,
  multiple-job numbering with dividers, the empty-list graceful message,
  and sensitive-information filtering (asserts the full tailored resume,
  experience bullets, professional summary, and drafted application
  message never appear in the output — even though all of that content
  exists on the input `ApplicationPackage`).
- `tests/notifications/whatsappProvider.test.ts` — missing-credentials
  handling (no network call attempted), invalid (non-E.164) recipient,
  successful delivery, the full error family (auth 401/403, rate limit
  429, network failure, timeout, unexpected status, invalid JSON), and a
  dedicated test proving the API token never appears in a thrown error
  message.
- `tests/notifications/notificationService.test.ts` — a `FAILED` (Resume
  QA FAIL) result and a `HUMAN_REVIEW_REQUIRED` (application package not
  generated) result are both excluded from the notification and never
  cause the provider to be called when they're the only results; empty
  input; provider failure (both a thrown error and a `success: false`
  response); and a successful multi-job digest.

All of the above mock the provider entirely. No automated test sends a
real WhatsApp message.

## Current coverage (Phase 8: n8n Orchestration API)

- `tests/schemas/careerRun.test.ts` — `CareerRunOptionsSchema` defaults
  (`maxJobs=20, topJobs=5, sendWhatsApp=false, dryRun=true`), validation
  limits (`maxJobs`/`topJobs` upper bounds, non-integer/non-boolean
  rejection), and `CareerRunResultSchema` round-trip validation.
- `tests/services/careerOrchestrationService.test.ts` — `runCareerPipeline()`
  with the job source, Claude client, and notification provider all
  mocked: successful dry run (no WhatsApp call even with a provider
  injected), successful normal run (`dryRun=false` + `sendWhatsApp=true`
  sends exactly one notification), idempotency (a repeated
  `idempotencyKey` returns the cached result and the job source/Claude
  client are never called a second time — including when the second
  request's options differ from the first), empty job results (all-zero
  counts, zero Claude calls), partial pipeline failure (one job's resume
  tailoring throws — the run still returns `PARTIAL` with the other job's
  package intact), a Claude-not-configured discovery failure (returns
  `status: "FAILED"` rather than throwing), a job-source failure (same),
  a WhatsApp provider failure (returns `PARTIAL` with
  `applicationPackagesCreated` unaffected — proving a notification failure
  never destroys the job analysis result), a Resume QA `FAIL` outcome
  (recorded as a normal `FAILED` application-package result, `status`
  stays `COMPLETED`, and the application-message Claude call is correctly
  skipped), default `dryRun` behavior (`sendWhatsApp=true` alone still
  sends nothing), `sendWhatsApp` disabled by default (`dryRun=false` alone
  still sends nothing), and a dedicated test asserting the full tailored
  resume text, the master resume, a career-profile field, and the
  drafted application message never appear anywhere in the serialized
  result.
- `tests/api/careerRun.test.ts` — `POST /career/run` end-to-end via
  Supertest: missing `Authorization` header (401, "Missing API key"), a
  wrong bearer token (401, "Invalid API key"), no
  `CAREER_AGENT_API_KEY` configured server-side at all (503, refuses
  every request rather than allowing unauthenticated access by default),
  a dedicated test proving the configured key is never echoed back in an
  error response, a successful dry run (200, correct summary shape),
  default body (`{}` still yields `dryRun: true`), an invalid body
  (out-of-range `maxJobs` → 400), idempotency via the real
  `Idempotency-Key` HTTP header (the job source is called exactly once
  across two identical requests), a generic 500 with no internal detail
  when something throws from outside `runCareerPipeline`'s own internal
  error handling (simulated via a broken `idempotencyStore.get()` —
  the more common failure paths, like a job-source error, are caught
  internally and returned as a normal `200 { status: "FAILED" }`, so this
  test deliberately exercises the route's own catch-all instead), and a
  test proving the tailored resume text, the drafted application message,
  and the API key never appear in a successful response body.

All of the above mock the job source, Claude client, and notification
provider entirely. No automated test calls the real Remotive API, the real
Claude API, or sends a real WhatsApp message.

## Manual live career-orchestration test

`tests/integration/careerRun.manual.ts` calls the real, in-process
`runCareerPipeline()` — real Remotive, real Claude — but **always** with
`dryRun=true` and `sendWhatsApp=false`, forced in the script itself,
regardless of what's passed to it, so it never sends a WhatsApp message and
never creates anything beyond an in-memory result:

```bash
npm run test:career:live
```

Exits immediately (exit code 1, no network call) if `CLAUDE_API_KEY` isn't
set, or if `profile/master_resume.md`/`profile/career_profile.md` still
look unfilled. Prints only a safe summary — `runId`, `status`, job
counts, `topJobs` (role/company/scores/classification/applicationStatus
only), package/notification counts, and duration — never a full resume,
the career profile, or personal contact information.

## Manual live WhatsApp test

`tests/integration/whatsapp.manual.ts` sends exactly ONE controlled test
message via the real Meta WhatsApp Cloud API:

```bash
npm run test:whatsapp
```

Exits immediately with a clear message (exit code 1) and **makes no
network call at all** if `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
or `WHATSAPP_RECIPIENT_NUMBER` are missing. Prints only delivery
success/failure and the provider's status/message id — never credentials,
never a real job notification, never the full resume.

## Tooling

- **Vitest** is the test runner (`npm run test`, `npm run test:watch`).
- **Supertest** drives HTTP assertions against the Express app in-process,
  without binding a real port.

## Rules for future test suites

- No fake or trivial tests — a test must exercise real behavior, matching
  `CLAUDE.md` rule 18 ("never claim a feature is complete without testing
  it") and rule 17 ("run tests after every implementation phase").
- Any code in `src/ranking/` (deterministic scoring/filtering) should be
  tested with plain unit tests — no mocking of Claude needed, since this
  layer never calls the API.
- Any code in `src/agents/` or `src/services/` that calls the Claude API
  should have its Zod schema validation tested independently of live API
  calls (e.g., by testing the schema against representative fixture
  payloads), so tests stay fast and don't depend on network access or API
  cost.
- Prefer testing `src/schemas/` Zod schemas directly with both valid and
  invalid fixtures — this is where "AI said something malformed" bugs are
  meant to be caught.

## Running tests

```bash
npm run test        # single run
npm run test:watch  # watch mode
```
