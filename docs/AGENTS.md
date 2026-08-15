# Agents (Planned)

> **Status: foundation phase.** No agent below is implemented. This
> documents the intended responsibility and boundaries of each future
> agent so implementations stay consistent with `CLAUDE.md`.

## Design principle

Each agent is a coordinator, not a black box: it assembles context from
`profile/`, calls Claude through `src/services/`, validates the response
through a Zod schema in `src/schemas/`, and returns a typed result. Agents
do not perform deterministic calculations themselves — that logic lives in
`src/ranking/` and is called by the agent, not reimplemented inside a
prompt.

## Job Discovery (`src/services/jobDiscoveryService.ts` — implemented, Phase 6)

Not an "agent" in the same sense as the others below — it makes no Claude
calls of its own. It's the pipeline stage that feeds real external job
postings into the existing Job Matching Agent, reusing it as-is:

- **Provider abstraction (`src/jobSources/jobSource.ts`):** `JobSource` —
  `searchJobs(criteria)`, `getJob(jobId)`, `normalize(raw)`. The discovery
  service is coupled only to this interface, never to a specific provider.
- **First provider: Remotive** (`src/jobSources/remotiveJobSource.ts`) — a
  free, keyless, public remote-jobs API. Verified live during
  implementation (see the Phase 6 report for details). Makes exactly **one**
  network call per `searchJobs()` invocation regardless of how many role
  keywords are configured, and caches results behind a configurable
  throttle (`REMOTIVE_MIN_FETCH_INTERVAL_HOURS`, default 6h) — Remotive's
  own published guidance caps daily calls in the single digits.
- **Role discovery (`src/jobSources/roleDiscovery.ts`):** a maintained,
  evidence-grounded default role-keyword list (direct QA/QE roles, AI
  Quality roles, and adjacent roles the career profile actually supports)
  — not parsed from `job_preferences.md`'s free-text "Target Roles"
  section at runtime, since that's prose, not a clean title list. Any
  caller-supplied `criteria.roleKeywords` overrides it entirely.
- **Pipeline:** Job Source → Normalize → Validate (reuses
  `jobSourceService.loadJobsFromInput`, Phase 2) → Deduplicate (new
  `jobDeduplicationService.ts`, source-namespaced externalJobId or a
  company+title+location+source composite) → recency filter
  (`postedWithinDays`) → the **existing, unmodified** Phase 2
  `analyzeJobs()` (deterministic filter → Claude Job Matching → ranking →
  top N). Nothing about matching or ranking is reimplemented here.
- **Preferences:** `profileService.loadJobDiscoveryPreferences()` reads
  Target Countries (reusing Phase 2's parser), Preferred/Excluded
  Industries, Roles to Avoid, Preferred Technologies, Remote/Hybrid/Onsite
  Preference, and Minimum Experience from `job_preferences.md` — every
  field is `undefined` (never defaulted) until the user fills in that
  section. `jobFilterService.ts`'s `FilterOptions` gained two new optional
  fields (`rolesToAvoid`, `excludedIndustries`) to carry these through —
  additive, backward-compatible with Phase 2.
- **Salary:** preserved when the source discloses it (a conservative,
  non-inventive parse of Remotive's free-text salary field — only a clean
  dollar figure/range counts, anything else is left `UNKNOWN`); never
  estimated, never asked of Claude.

## Notifications (`src/notifications/` — implemented, Phase 7)

Makes no Claude calls — the message is assembled deterministically from
data Phases 2–5 already produced (Phase 7 spec §12, token efficiency).

- **Provider abstraction (`src/notifications/notificationProvider.ts`):**
  `NotificationProvider` — `sendNotification(message)`. Mirrors the
  `JobSource` pattern from Phase 6 so a second channel (Telegram, email)
  can be added later without touching `notificationService.ts` or any
  earlier phase.
- **Provider selected: Meta WhatsApp Business Platform — Cloud API**
  (`src/notifications/whatsappProvider.ts`), the official, direct API run
  by Meta itself — not a third-party BSP, not WhatsApp Web automation, no
  QR codes, no session hijacking. Chosen specifically because the Phase 7
  spec's required env var shape (`WHATSAPP_API_TOKEN` +
  `WHATSAPP_PHONE_NUMBER_ID`) is Meta Cloud API's own terminology
  (`phone_number_id` is literally what Meta's endpoint path parameter is
  called), not a BSP alternative like Twilio (which uses an Account
  SID + a "from" number string, a different shape).
  - **Real operational constraint, documented rather than hidden:** Meta
    requires business-initiated messages to use a pre-approved *Message
    Template* unless sent within 24 hours of the recipient last messaging
    the business number. This provider sends plain `type: "text"`
    messages, which only succeed within that 24h session window. For
    ongoing proactive notifications (the recipient hasn't necessarily
    messaged first), you'll either need to message your own WhatsApp
    Business number periodically to keep a session open, or create and
    get a template approved in Meta Business Manager — that approval step
    is not something this codebase can do programmatically and is not
    implemented here (Phase 7 spec §7 explicitly scoped this phase to
    "reliable notification delivery," not interactive/template messaging).
- **Message builder (`src/notifications/whatsappMessageBuilder.ts`):**
  pure, deterministic formatting of an `ApplicationPackage[]` (Phase 5's
  existing type, reused as-is — no new data plumbing needed). Deliberately
  excludes the full tailored resume, the drafted application message, and
  any career-profile content — only role/company/location/scores/salary/
  top-3 evidence bullets/QA status/job URL, per the Phase 7 privacy rules.
- **Orchestration (`src/notifications/notificationService.ts`):**
  `notifyTopOpportunities()` filters a mixed
  `ApplicationPackageResult[]` (PASS/FAIL/REVIEW_REQUIRED) down to only
  the `READY_FOR_REVIEW` ones before building/sending — a `FAILED` or
  `HUMAN_REVIEW_REQUIRED` result is never mentioned in the notification,
  enforced structurally rather than checked ad hoc per call site. Sends
  nothing (never calls the provider) when there's nothing eligible.
- **Human review, not automatic application:** the message always shows
  `Resume QA: PASS` / `Application Package: READY_FOR_REVIEW` — never
  `APPLIED`, which remains structurally impossible to produce (Phase 5's
  `ApplicationPackageSchema` still locks `applicationStatus` to a Zod
  literal). WhatsApp is a notify-and-review channel only; nothing in this
  phase submits anything anywhere.

## Planned agents

### Job Matching Agent (`src/agents/`, not yet created)
- **Input:** a raw job listing, `career_profile.md`, `job_preferences.md`.
- **Does:** asks Claude to semantically assess fit — does this role align
  with the person's skills, experience level, and stated goals. Should not
  treat the person's current job title as a ceiling: per
  `career_profile.md` → Career Goals, it should also surface adjacent,
  high-value roles (e.g. AI Assurance, LLM Evaluation, AI Quality
  Architecture) that the profile is already qualified for but isn't
  explicitly titled/targeting.
- **Does not:** apply hard filters like salary floor or excluded
  industries — those are deterministic and live in `src/ranking/`.
- **Output:** a structured match assessment, validated by a Zod schema,
  including a fit rationale — labeled as an estimate, never as an ATS
  score (see `CLAUDE.md` rule 6).
- **Compensation classification (`src/ranking/`, deterministic, not the
  agent itself):** the target design classifies every job as `LOW` /
  `MARKET` / `ABOVE_MARKET` / `HIGH_POTENTIAL` / `UNKNOWN` based on
  market-rate research per location/role/seniority (see
  `job_preferences.md` → Compensation Strategy) — never a single hardcoded
  number, and never inferred from the user's current salary. A job is
  never rejected solely for having undisclosed salary; it's marked
  `UNKNOWN` and kept in consideration.
  **Current implementation status (as of Phase 2):** only the `UNKNOWN`
  case and a caller-supplied-reference ratio score (`salaryPotential`,
  0–100, nullable) exist today — see `src/ranking/jobRanking.ts`. The full
  `LOW`/`MARKET`/`ABOVE_MARKET`/`HIGH_POTENTIAL` banding is **not yet
  implemented**, because doing it correctly requires real market
  compensation data this codebase does not have. That data — and the
  banding logic built on top of it — is deferred to a future **Salary
  Intelligence phase**, not fabricated here.

### Resume Tailoring Agent (`src/agents/resumeTailoringAgent.ts` — implemented, Phase 3)
- **Input:** a validated `Job`, `career_profile.md` (a broader field set than
  Job Matching uses — includes Achievements/Certifications/Education),
  `master_resume.md` verbatim, and optionally `job_preferences.md` → Target
  Roles (positioning language only, never a source of new facts).
- **Does:** reorders, trims, and rewords existing resume content to
  emphasize what's relevant to the job; maps each JD requirement to
  DIRECT_MATCH/TRANSFERABLE/PARTIAL_MATCH/GAP/UNKNOWN evidence before
  writing the tailored text (see `src/prompts/resumeTailoring.ts`).
- **Does not:** add skills, achievements, technologies, certifications,
  projects, employers, job titles, responsibilities, domain experience, AI
  experience, or leadership experience not already present in
  `master_resume.md`/`career_profile.md` (see `CLAUDE.md` rules 1–4). Never
  upgrades TRANSFERABLE to DIRECT_MATCH or converts a GAP into a claimed
  qualification.
- **Output:** a structured `TailoredResume` (validated by
  `src/schemas/tailoredResume.ts`), status always exactly
  `READY_FOR_RESUME_QA` — never auto-approved, and not written to
  `resumes/` by this phase (no file-writing step exists yet).
- **Deterministic layer on top (`src/services/resumeTailoringService.ts`,
  not Claude):** "JD Keyword Alignment" — never called an ATS score — is
  computed by checking each JD-listed skill against the actual source text,
  split into Supported/Missing/Unsupported. A second, separate check flags
  any `coreSkills`/`certifications` entry Claude produced that isn't
  traceable to the source materials (`unsupportedClaims`). **Known scope
  limit:** neither check inspects free-text claims inside
  `professionalSummary`, experience bullets, or the final `tailoredResume`
  string — a hallucinated metric or responsibility embedded in prose is not
  deterministically caught in Phase 3; that relies on the prompt's
  anti-hallucination instructions, Claude's own `claimsRequiringVerification`
  self-reporting, and human review before Resume QA (Phase 4).

### Resume Evidence Guard Agent (`src/agents/resumeEvidenceAgent.ts` — implemented, Phase 3.1)
- **Input:** `master_resume.md`, `career_profile.md`, and a validated
  `TailoredResume` (Phase 3's output).
- **Does:** independently extracts every discrete factual claim from the
  tailored resume's free text (`professionalSummary`, experience bullets,
  `tailoredResume`) and classifies each as SUPPORTED / TRANSFERABLE /
  POTENTIALLY_UNSUPPORTED / UNSUPPORTED / UNKNOWN against the real source
  material — closing the gap Phase 3 documented as a known limitation
  (free-text claims weren't deterministically checked there).
- **Does not:** rewrite the resume, remove claims, or decide what happens
  next — it only reports classified claims for Resume QA (Phase 4) to
  weigh in.
- **Output:** a `ResumeEvidenceReport` (`src/schemas/resumeEvidence.ts`).
  `status` (`PASS`/`REVIEW_REQUIRED`), `evidenceScore`, and `claimsReviewed`
  are always recomputed deterministically in
  `src/services/resumeEvidenceService.ts` from the classified claims —
  never trusted verbatim from Claude — including re-bucketing each claim by
  its own `classification` field rather than trusting which array Claude
  physically placed it in.

### Resume QA Agent (`src/agents/resumeQAAgent.ts` — implemented, Phase 4)
- **Input:** a validated `Job`, `career_profile.md`, `master_resume.md`
  verbatim, a validated `TailoredResume` (Phase 3), and a validated
  `ResumeEvidenceReport` (Phase 3.1).
- **Trust boundary — the most important property of this agent:** it does
  **not** trust the Resume Tailoring Agent's output, and does **not**
  assume the Evidence Guard result is correct either. Both are passed in
  explicitly labeled as unverified/untrusted in the prompt
  (`src/prompts/resumeQA.ts`), and the agent is instructed to re-derive
  everything from `master_resume.md`/`career_profile.md` directly. A QA
  finding can — and in tests, does — override a passing Evidence Guard
  result.
- **Does:** a single independent pass evaluating factual accuracy, JD
  requirement coverage (mandatory vs. preferred, DIRECT_MATCH/TRANSFERABLE/
  PARTIAL_MATCH/GAP/UNKNOWN), a "JD Alignment Score" (never called an ATS
  score — see `CLAUDE.md` rule 6 and `src/schemas/resumeQA.ts` →
  `JD_ALIGNMENT_SCORE_LABEL`), keyword analysis (supported/missing/
  unsupported/overused), seniority accuracy, and AI-claim scrutiny
  specifically — across the 20 QA dimensions listed in the Phase 4 spec.
- **Does not:** rewrite the resume, or silently pass through an issue —
  every finding is classified CRITICAL/HIGH/MEDIUM/LOW and returned for
  review.
- **Output:** a `ResumeQAReport` (`src/schemas/resumeQA.ts`) with status
  `PASS`/`FAIL`/`REVIEW_REQUIRED`. The status and `humanReviewRequired` are
  **deterministically enforced** in `src/services/resumeQAService.ts`,
  never trusted verbatim from Claude:
  1. Any `CRITICAL` issue forces `status = FAIL`, unconditionally.
  2. Any `HIGH` issue (with no `CRITICAL` issue) downgrades a self-reported
     `PASS` to `REVIEW_REQUIRED` — a resume is never silently approved with
     a HIGH-severity issue outstanding, per the spec's Human Review Rule.
     A Claude-issued `FAIL` in this case is respected as-is.
  3. With no `CRITICAL`/`HIGH` issues, Claude's own `PASS`/`REVIEW_REQUIRED`
     judgment stands.
  4. `humanReviewRequired` is `true` whenever `status !== "PASS"`, or
     whenever any `CRITICAL`/`HIGH` issue exists — "never automatically
     approve" is enforced in code, not left to the prompt alone.
  Issues are also re-bucketed by their own `severity` field, the same
  defensive pattern used for Evidence Guard claims.
- **Quality gate:** the Application Package service can only proceed after
  `status === "PASS"`. `FAIL` stops the pipeline; `REVIEW_REQUIRED`
  requires a human before anything downstream happens.

### Application Package (`src/services/applicationPackageService.ts` — implemented, Phase 5)
- Not a separate `src/agents/*` file — the Phase 5 spec asked for a
  service + schema + prompt only, so the one Claude call this step makes
  (drafting the application message) lives directly in the service, using
  the same retry/parse pattern as the other four agents rather than a
  fifth near-identical agent module.
- **Input:** a validated `Job`, `JobMatch` (Phase 2), `career_profile.md`,
  `master_resume.md` verbatim, a validated `TailoredResume` (Phase 3), and
  a validated `ResumeQAReport` (Phase 4). All five are re-validated inside
  the service — none trusted from the caller.
- **Quality gate — the central design point:**
  - `resumeQA.status === "FAIL"` → returns `{ status: "FAILED", ... }`
    (Claude is never called; nothing is generated).
  - `resumeQA.status === "REVIEW_REQUIRED"` → returns
    `{ status: "HUMAN_REVIEW_REQUIRED", ... }` (Claude is never called; no
    package is generated — the spec is explicit that this must not happen
    automatically).
  - Both are **returned values**, not thrown errors — FAIL and
    REVIEW_REQUIRED are legitimate pipeline outcomes, not exceptional
    conditions. Only genuinely malformed/missing input (no job, invalid
    job match, empty master resume, etc.) throws
    `InvalidApplicationPackageInputError`.
  - Only `resumeQA.status === "PASS"` proceeds to generate the package.
- **Application message:** one Claude call, instructed to draw only on the
  Career Profile, Master Resume, and Job Description — never inventing
  experience/achievements/metrics/technologies/certifications/employers/
  responsibilities (`src/prompts/applicationMessage.ts`). Never sent
  anywhere automatically.
- **Deterministic layer on top (not Claude):**
  - `resumeVersion` is a code-generated `ROLE_COMPANY_DATE` identifier
    (`generateResumeVersion()`), never produced by the model.
  - `applicationMessageUnsupportedClaims` — the same JD-skill-vs-source-text
    check used in `resumeTailoringService.ts` — flags any JD-listed skill
    that shows up in the generated message but isn't traceable to the
    Master Resume/Career Profile.
  - `applicationStatus` is a Zod `z.literal("READY_FOR_REVIEW")`, not a
    general enum — this is a schema-level guarantee, not just a runtime
    default, that this codebase cannot produce `"APPLIED"`. Only a future,
    explicitly human-triggered action (not built) could ever record that.
- **Master Resume immutability:** the input string is read-only source
  material throughout — the service contains no file-write calls anywhere
  (verified: no `writeFile`/`fs.write*` usage), so `profile/master_resume.md`
  is never touched by this or any earlier phase.
- **Output:** an `ApplicationPackage` (`src/schemas/applicationPackage.ts`),
  returned in-memory — not yet written to `applications/` (no
  file-persistence step exists yet).

## Orchestration API (`src/services/careerOrchestrationService.ts`, `src/api/routes/careerRun.ts` — implemented, Phase 8)

Not an agent and makes no Claude calls of its own — it is the single
`POST /career/run` entry point n8n calls to run the entire pipeline in one
request. Every step it performs is delegated to the existing, unmodified
service from an earlier phase; nothing here reimplements Job Discovery,
Job Matching, Resume Tailoring, Evidence Guard, Resume QA, Application
Package, or WhatsApp notification logic.

- **Sequence:** Job Discovery (Phase 6, which itself reuses Phase 2 Job
  Matching + ranking) → for each ranked job: Resume Tailoring (Phase 3) →
  Evidence Guard (Phase 3.1) → Resume QA (Phase 4) → Application Package
  (Phase 5) → WhatsApp (Phase 7, only if requested — see below).
- **`maxJobs`/`includeRankedJobs`:** two small, additive extensions made to
  `jobAnalysisService.ts`/`jobDiscoveryService.ts` to support this phase.
  `maxJobs` caps how many deterministically-eligible jobs are actually sent
  to Claude for matching (token/cost control); the result's `jobsEligible`
  always reports the true, uncapped filter count regardless. `includeRankedJobs`
  (opt-in, defaults `false`/absent) additionally returns the full
  `RankedJob[]` (real `Job` + `JobMatch` objects) so the orchestrator can
  feed real jobs into Resume Tailoring without re-deriving them — existing
  callers (`POST /jobs/analyze`, `POST /jobs/discover`) are unaffected since
  the flag defaults off.
- **dryRun (default `true`) / sendWhatsApp (default `false`):** discovery,
  matching, tailoring, Evidence Guard, Resume QA, and Application Package
  generation always run regardless of these flags — only the WhatsApp send
  is gated, and only when both `sendWhatsApp === true` **and**
  `dryRun === false`. The endpoint can never submit an application; that
  remains structurally impossible (Phase 5's `ApplicationPackageSchema`
  still locks `applicationStatus` to a Zod literal).
- **A single job's failure never aborts the run:** each ranked job's
  tailor→evidence→QA→package sequence runs inside its own try/catch; a
  failure is recorded and the loop continues with the next job. The
  aggregate `status` (`COMPLETED`/`PARTIAL`/`FAILED`) reflects whether any
  per-job failures or a WhatsApp failure occurred — see
  `docs/WORKFLOW.md` for the exact rule. A Resume QA `FAIL`/`REVIEW_REQUIRED`
  outcome is a normal *returned* result (Phase 5's own design, unchanged
  here), not a per-job failure — it does not push the run to `PARTIAL`.
- **A WhatsApp failure never destroys the job analysis result:** the send
  is wrapped in its own try/catch; on failure the run's `topJobs` and
  `applicationPackagesCreated` are still returned as computed, with `status`
  downgraded to `PARTIAL`.
- **Idempotency (no database):** an in-memory `Map`-backed
  `InMemoryIdempotencyStore` (24h TTL), keyed by the caller-supplied
  `Idempotency-Key` header. Checked before any work begins; a repeated key
  returns the exact cached result instead of re-running the pipeline —
  including a cached `FAILED` result from a prior discovery-stage error.
- **Response shape is a summary only:** `CareerRunResult`
  (`src/schemas/careerRun.ts`) never includes a full resume, the career
  profile, or the full job description — `topJobs` entries carry only
  role/company/sourceUrl/scores/classification/applicationStatus.
- **Auth is the route's concern, not the service's:** `runCareerPipeline()`
  itself has no notion of API keys; `src/api/routes/careerRun.ts` enforces
  `Authorization: Bearer <CAREER_AGENT_API_KEY>` before calling it at all
  (see `docs/SECURITY.md`).

## Boundaries that apply to every agent

- No agent submits anything anywhere. The pipeline's final output is a
  reviewed package plus a notification (see `docs/WORKFLOW.md`).
- No agent invents facts about the user. If information is missing from
  `profile/`, the agent should surface that gap rather than fill it in.
- Every Claude response an agent consumes programmatically is validated
  with Zod before it's trusted.
