# Security (Planned)

> **Status: foundation phase.** This documents the security posture and
> constraints for this project going forward — not a description of
> controls already implemented beyond basic secret hygiene.

## Secrets

- All credentials (`CLAUDE_API_KEY`, `N8N_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_CHAT_ID`, `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_RECIPIENT_NUMBER`, `CAREER_AGENT_API_KEY`) live only in a local
  `.env` file, loaded via `src/config/env.ts`. The user's own WhatsApp
  number (`WHATSAPP_RECIPIENT_NUMBER`) is treated as a credential-adjacent
  secret for this purpose — never hardcoded anywhere in source (verified by
  grep).
- `.env` is gitignored. Only `.env.example`, with empty placeholder values,
  is committed.
- Secrets must never be logged, printed in error messages, or written into
  files under `resumes/`, `applications/`, or `docs/`.
- No secret is ever hardcoded in source.

## Personal data

- `profile/career_profile.md`, `profile/master_resume.md`, and
  `profile/job_preferences.md` contain personal career data. They are
  currently tracked in git as placeholders; once filled in with real
  information, treat them as sensitive and consider whether this repo
  should remain private.
- `resumes/` and `applications/` contain generated personal data and are
  gitignored.

## API exposure

- **`POST /jobs/analyze` and `POST /jobs/discover` still have no
  authentication.** Locally, DO NOT expose either publicly, bind them to a
  non-localhost interface, or put them behind a public URL/tunnel (e.g.
  ngrok) — both remain suitable for localhost development only.
  **Important consequence of Vercel deployment (see `docs/DEPLOYMENT.md`):**
  Vercel's zero-config Express support deploys the *entire* app as one
  Function and routes every path to it, so once deployed, `/jobs/analyze`
  and `/jobs/discover` become reachable at the deployment's public HTTPS
  URL with **no authentication**, alongside the now-authenticated
  `/career/run`. This
  wasn't true before this change and is a real, deliberately-flagged
  tradeoff of the smallest-possible Vercel setup — adding auth to those two
  routes was out of scope for "keep all existing functionality unchanged"
  and "add the minimum required configuration." If you deploy this
  project, either accept that `/jobs/analyze` and `/jobs/discover` are
  public and unauthenticated, or use Vercel's own deployment-protection
  feature (password/SSO on the whole deployment) until those two routes
  get their own auth layer.
- **`POST /career/run` (Phase 8) requires authentication** —
  `Authorization: Bearer <CAREER_AGENT_API_KEY>` — and is the only
  endpoint in this codebase with its own auth layer:
  - The key is read from the `CAREER_AGENT_API_KEY` environment variable
    only, via `src/config/env.ts` — never hardcoded, never accepted from a
    request body or query string.
  - If the server has no `CAREER_AGENT_API_KEY` configured at all, the
    endpoint refuses **every** request with `503`, rather than falling
    back to allowing unauthenticated access.
  - A missing `Authorization` header returns `401` ("Missing API key"); a
    present-but-wrong bearer token returns `401` ("Invalid API key") —
    distinct messages, but neither ever echoes the configured key back in
    the response (verified by test).
  - The key is compared with a plain string equality check
    (`src/api/routes/careerRun.ts`); this is a shared-secret mechanism
    appropriate for a single trusted caller (n8n) over a private network,
    not a multi-tenant auth system.
  - The key is never logged — `safeLog()` in `careerRun.ts` only ever
    emits `runId`/`stage`/counts/status/duration/`errorType`.
  - Even authenticated, this endpoint still must not be exposed publicly
    without additional network-level protection (e.g. a private tunnel or
    VPN between n8n and this service) — the bearer-token check alone is
    not a substitute for keeping the service off the open internet.

## Idempotency (Phase 8)

- `POST /career/run` accepts an `Idempotency-Key` header. A repeated key
  returns the exact cached `CareerRunResult` (including a cached `FAILED`
  result from a prior discovery-stage error) instead of re-running the
  pipeline — this is what prevents an accidental duplicate execution (e.g.
  an n8n retry after a slow response) from re-discovering jobs, re-calling
  Claude, or re-sending a WhatsApp notification.
- Backed by an in-memory `Map` (`InMemoryIdempotencyStore`, 24h TTL) — no
  database was introduced, per the Phase 8 spec's explicit constraint. This
  means the cache does not survive a process restart and is not shared
  across multiple server instances; acceptable for this project's
  single-process, personal-use deployment model, and documented here as a
  known limitation rather than left implicit. **On Vercel specifically**
  (see `docs/DEPLOYMENT.md`), this same in-memory store lives inside one
  serverless function invocation's process — a "warm" invocation reuses it,
  but there's no guarantee two back-to-back requests land on the same warm
  instance, so idempotency protection there is best-effort, not a hard
  guarantee, exactly as it already was locally under process restarts.
- The cache key is the raw `Idempotency-Key` header value only — never
  logged, never derived from or containing any personal data.

## Platform restrictions

- This project never bypasses CAPTCHA, authentication, bot detection, or
  any platform's terms of use (`CLAUDE.md` rule 13).
- This project never automates unauthorized activity on LinkedIn or any
  other job platform (`CLAUDE.md` rule 12). There is no scraping or
  automated-submission functionality, planned or otherwise, in this phase.
- `src/jobSources/remotiveJobSource.ts` (Phase 6) only calls Remotive's
  official public API, never scrapes a page, and respects Remotive's own
  published rate-limit guidance via a configurable throttle/cache
  (`REMOTIVE_MIN_FETCH_INTERVAL_HOURS`) rather than polling aggressively.
  It requires no credentials (a free, keyless API), so there is nothing to
  leak from this integration specifically — verified: no `console.*` calls
  and no secret-shaped strings anywhere in `src/jobSources/`.
- `src/notifications/whatsappProvider.ts` (Phase 7) only calls the
  official, direct Meta WhatsApp Business Cloud API — never WhatsApp Web
  automation, never a QR-code/session-based approach, never credential
  scraping. It never automatically submits a job application; it only
  notifies. Verified: no `console.*` calls anywhere in `src/notifications/`,
  and a dedicated test proves the API token never appears in a thrown
  error's message (the token only ever goes in the `Authorization` HTTP
  header, never the request body or logs).

## WhatsApp / notification data handling (Phase 7)

- The WhatsApp message text is built exclusively from
  `src/notifications/whatsappMessageBuilder.ts`, which deliberately never
  reads `ApplicationPackage.resume.tailoredResume`,
  `resume.experience[].bullets`, `resume.professionalSummary`, or
  `applicationMessage` — verified by dedicated tests asserting none of
  that content can appear in the output text, even though it exists on the
  input object.
- `notificationService.ts` never sends a notification for a `FAILED` or
  `HUMAN_REVIEW_REQUIRED` result — only `READY_FOR_REVIEW` packages (Resume
  QA `PASS`) are ever summarized.
- `tests/integration/whatsapp.manual.ts` prints only delivery
  success/failure and the provider's status/message id — never the token,
  never the recipient number, never a real job notification.

## Human in the loop

- No stage of the pipeline submits a job application. The last automated
  step is always a notification; a human decides whether and how to apply
  (`CLAUDE.md` rule 14).

## Resume tailoring data handling (Phase 3)

- `src/services/resumeTailoringService.ts` and
  `src/agents/resumeTailoringAgent.ts` never log the full master resume,
  full career profile, or personal contact information (name, email,
  phone). Neither file calls `console.log`/`console.error` at all — errors
  are thrown as typed errors (`InvalidTailoringInputError`,
  `ClaudeApiError`, `InvalidClaudeResponseError`,
  `ClaudeResponseValidationError`) for the caller to handle.
- `InvalidClaudeResponseError.rawText` and `ClaudeResponseValidationError.issues`
  carry extra debug context (the raw model response text; Zod issue
  strings) that a future caller must **not** log directly — always go
  through `toSafeErrorMessage()` (name + message only), never
  `JSON.stringify(error)` or similar, once this is wired into a route or
  log sink in a later phase.
- `tests/integration/resumeTailoring.manual.ts` (the real-Claude dev script)
  only prints summary fields to the console — status, target role/company,
  JD keyword alignment, and counts — never the full tailored resume or
  source profile content.
- The job payload passed through this pipeline is the already-validated
  `Job` object from Phase 2 (job posting data), not personal data about the
  candidate — the candidate's personal data lives only in
  `profile/master_resume.md` and `profile/career_profile.md`.

## Resume evidence guard data handling (Phase 3.1)

- `src/services/resumeEvidenceService.ts` and
  `src/agents/resumeEvidenceAgent.ts` never call `console.log`/`console.error`
  either — same posture as Phase 3, errors are thrown as typed errors
  (`InvalidEvidenceInputError`, `ClaudeApiError`,
  `InvalidClaudeResponseError`, `ClaudeResponseValidationError`).
- There is no standalone Phase 3.1 manual integration script — it's
  exercised as the middle step of `tests/integration/resumeQA.manual.ts`
  (see below), which also only prints summary fields.

## Resume QA data handling (Phase 4)

- `src/services/resumeQAService.ts` and `src/agents/resumeQAAgent.ts` never
  call `console.log`/`console.error` — same posture as Phases 3 and 3.1.
  Errors are thrown as typed errors (`InvalidQAInputError`,
  `ClaudeApiError`, `InvalidClaudeResponseError`,
  `ClaudeResponseValidationError`) for the caller to handle.
- **No HTTP endpoint exists yet for Resume QA** (or Resume Tailoring, or the
  Evidence Guard) — so "don't expose raw Claude responses through HTTP
  errors" (Phase 4 spec §16) has no live surface to violate today. This is
  recorded here as a forward constraint: when any of these three services
  eventually gets an HTTP route, its error handler must map thrown errors to
  safe, generic messages (the same pattern `src/api/routes/jobs.ts` already
  uses for `POST /jobs/analyze`) — never `res.json(error)` or similar, which
  would leak `InvalidClaudeResponseError.rawText` (the raw model response,
  potentially containing resume-derived text) straight into an HTTP
  response body.
- `tests/integration/resumeQA.manual.ts` runs the full Tailoring → Evidence
  Guard → QA chain against one fixture job and prints only summary fields
  (status, scores, issue counts) — never the full resume, profile, or
  personal contact information.

## Application Package data handling (Phase 5)

- `src/services/applicationPackageService.ts` never calls
  `console.log`/`console.error` (verified by grep — zero matches) and
  contains no file-write calls (`writeFile`/`fs.write*`) anywhere — the
  Master Resume string passed in is read-only source material and
  `profile/master_resume.md` is never touched.
- Errors are thrown as typed errors (`InvalidApplicationPackageInputError`,
  `ClaudeApiError`, `InvalidClaudeResponseError`,
  `ClaudeResponseValidationError`) — the same `InvalidClaudeResponseError.rawText`
  caveat from Phase 4 applies here too (no HTTP endpoint yet, but the same
  forward constraint holds).
- `tests/integration/applicationPackage.manual.ts` runs the full job match
  → tailoring → evidence guard → QA → package chain and prints only
  summary fields (status, applicationId, resumeVersion, matchScore,
  message length) — never the full resume, profile, application message
  text, or personal contact information.
- `applicationStatus` can only ever be `"READY_FOR_REVIEW"` — enforced as a
  Zod `z.literal`, not just a runtime default — so there is no code path in
  this codebase that could log or return an `"APPLIED"` status.

## Orchestration API data handling (Phase 8)

- `src/services/careerOrchestrationService.ts` logs only through the
  `log()` callback the caller injects (`safeLog()` in the route) — every
  call site passes `runId`/`stage`/counts/status/`errorType`/`durationMs`
  only, never a job description, resume content, career-profile field, or
  the API key. Where a caught error is logged, it goes through
  `toSafeErrorMessage()` (name + message only), the same pattern used by
  every earlier phase — never `JSON.stringify(error)` or a raw stack trace.
- `CareerRunResult` (`src/schemas/careerRun.ts`) is a deliberately narrow
  summary: `topJobs` entries carry only
  role/company/sourceUrl/matchScore/careerScore/classification/
  applicationStatus — no full job description, no tailored resume text, no
  application message, no career-profile content. Verified by dedicated
  tests at both the service and route level asserting none of that content
  can appear in the serialized result, even though it exists on the
  in-memory objects the orchestrator handles internally.
- `src/api/routes/careerRun.ts`'s error handling maps every thrown error to
  a generic, safe HTTP response (`400`/`503`/`500` with a fixed message) —
  it never does `res.json(error)` or similar, so no `InvalidClaudeResponseError.rawText`,
  Zod issue detail beyond the intentionally-exposed `InvalidOrchestrationInputError.issues`
  (validation-shape errors only, e.g. "maxJobs: Number must be less than or
  equal to 200" — never resume-derived text), or stack trace can reach an
  HTTP response body.
- `tests/integration/careerRun.manual.ts` (the real-Claude/real-Remotive
  dev script) prints only the same safe summary fields as the HTTP
  response — never a full resume, the career profile, or personal contact
  information — and forces `dryRun=true`/`sendWhatsApp=false` in the script
  itself, so it can never send a real WhatsApp message or leave any
  external side effect.

## AI output handling

- All Claude API responses that are consumed programmatically are parsed
  through a Zod schema before use, so malformed or unexpected model output
  fails loudly instead of propagating (`CLAUDE.md` rule 9).
- Match scores are estimates of semantic fit, not certified ATS scores, and
  must be labeled as such anywhere they're surfaced (`CLAUDE.md` rule 6).

## Dependencies

- Only dependencies required for the current phase are installed (Express,
  the Claude SDK, Zod, dotenv, Vitest, TypeScript tooling). New dependencies
  should be added deliberately, not speculatively.
