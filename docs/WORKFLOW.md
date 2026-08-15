# Workflow

> **Status: Phase 8 complete.** The entire pipeline below — job discovery
> through WhatsApp notification — is now callable as a single request via
> `POST /career/run` (`src/api/routes/careerRun.ts`,
> `src/services/careerOrchestrationService.ts`), the endpoint n8n calls.
> Every step it runs is the same existing service from its own phase;
> nothing is reimplemented. `POST /jobs/analyze` and `POST /jobs/discover`
> still work standalone, unchanged. This describes the intended end-to-end
> flow; steps are marked implemented vs. planned below.

## Pipeline

```
1. n8n trigger (schedule or manual) -> POST /career/run       [IMPLEMENTED — Phase 8]
   src/api/routes/careerRun.ts — the single orchestration entry point;
   requires Authorization: Bearer <CAREER_AGENT_API_KEY>. n8n still owns
   scheduling/triggering itself — the n8n workflow definition is not built
   in this codebase.
        │
2. Job Source — Remotive (public, keyless API)                [IMPLEMENTED — Phase 6]
   src/jobSources/ — provider-abstracted; a second provider can be added
   without touching the discovery service, matching, or ranking logic
        │
3. Claude Job Matching — semantic comparison of each job against  [IMPLEMENTED — Phase 2]
   profile/career_profile.md and profile/job_preferences.md
        │
4. Deterministic ranking (src/ranking/) — apply hard filters      [IMPLEMENTED — Phase 2]
   (salary floor, target countries) and score the matched candidates
        │
5. Top 5 Jobs — the highest-ranked jobs are selected               [IMPLEMENTED — Phase 2]
        │
6. Claude Resume Tailoring — rewrite/reorder content from          [IMPLEMENTED — Phase 3]
   profile/master_resume.md to fit the selected job, without
   inventing content. Status is always READY_FOR_RESUME_QA.
        │
7. Resume Evidence Guard — an independent Claude pass extracts     [IMPLEMENTED — Phase 3.1]
   and classifies every free-text claim in the tailored resume
   against the real source material (SUPPORTED/TRANSFERABLE/
   POTENTIALLY_UNSUPPORTED/UNSUPPORTED/UNKNOWN)
        │
8. Resume QA — an independent Claude pass that trusts neither      [IMPLEMENTED — Phase 4]
   step 6's output nor step 7's result; evaluates factual accuracy,
   JD requirement coverage, JD Alignment Score, keyword quality,
   seniority accuracy, and AI-claim scrutiny. Returns PASS / FAIL /
   REVIEW_REQUIRED. FAIL stops the pipeline; REVIEW_REQUIRED needs a
   human before anything proceeds.
        │
9. Application Package — job info, job match summary, tailored resume,  [IMPLEMENTED — Phase 5]
   Resume QA summary, and a Claude-drafted application message, assembled
   into one artifact with a deterministic resumeVersion (ROLE_COMPANY_DATE)
   and applicationStatus locked to READY_FOR_REVIEW. Only proceeds when
   step 8 is PASS — FAIL returns a FAILED result (pipeline stops) and
   REVIEW_REQUIRED returns HUMAN_REVIEW_REQUIRED (no package generated).
   Not yet written to applications/ — returned in-memory only.
        │
10. WhatsApp — a deterministic digest (no Claude call) summarizing     [IMPLEMENTED — Phase 7]
    only the READY_FOR_REVIEW packages is sent via the Meta WhatsApp
    Business Cloud API (src/notifications/). FAILED/HUMAN_REVIEW_REQUIRED
    results are never mentioned. No full resume, no application message
    text, no career-profile content is included — only what's needed to
    evaluate the opportunity.
        │
11. Human Review — the user reads the WhatsApp message and decides      [IMPLEMENTED as messaging — Phase 7]
        │
12. Manual Application — the user applies themselves; this project      [PLANNED]
    never submits an application automatically. applicationStatus can
    only ever be READY_FOR_REVIEW — never APPLIED — enforced at the
    schema level, not just by convention.
```

## Stage boundaries

- Steps 3, 6, 7, 8, and 9 are the only steps that call the Claude API (step
  9 makes exactly one call, to draft the application message — everything
  else in the package is assembled deterministically from earlier steps'
  already-validated output).
- Step 4 is plain TypeScript — no AI call, fully deterministic and testable.
- Every Claude response (steps 3, 6, 7, 8, 9) is validated against a Zod
  schema in `src/schemas/` before being used in a later step, and each
  step's status/score/identifier fields that have a clear deterministic
  rule (`MATCH_SCORE_LABEL`, ranking `careerScore`, Evidence Guard's
  `status`/`evidenceScore`, Resume QA's `status`/`humanReviewRequired`,
  Application Package's `resumeVersion`/`applicationStatus`) are
  recomputed/assigned in code rather than trusted verbatim from the model.
- Step 8 (Resume QA) explicitly does not trust step 6 or step 7 — see
  `docs/AGENTS.md` → Resume QA Agent for the trust-boundary design.
- The pipeline has no step that submits anything to a job board or
  employer. Step 12 is always manual, and step 9's `applicationStatus` can
  only ever be `READY_FOR_REVIEW` — never `APPLIED` — enforced at the
  schema level (see `docs/AGENTS.md` → Application Package).
- Step 10 (WhatsApp) makes zero Claude calls — the message is assembled
  deterministically from data steps 3–9 already produced.
- Steps 6, 7, 8, 9, and 10 are each still standalone TypeScript services
  (`resumeTailoringService.ts`, `resumeEvidenceService.ts`,
  `resumeQAService.ts`, `applicationPackageService.ts`,
  `notifications/notificationService.ts`) with no HTTP endpoint of their
  own — Phase 8's `POST /career/run` is the first (and only) HTTP surface
  that calls them, and it calls them in sequence rather than giving each
  one its own route. Nothing writes a package to `applications/` yet
  either (it's returned in-memory only, and `POST /career/run`'s response
  omits it entirely — see `docs/AGENTS.md` → Orchestration API).
- **`POST /career/run`'s run-level `status`** (`COMPLETED`/`PARTIAL`/`FAILED`):
  `FAILED` only when job discovery itself fails (job source error or
  Claude not configured) — nothing to report. `PARTIAL` when at least one
  job's tailor→evidence→QA→package sequence throws, or the WhatsApp send
  fails, while at least one other job still completed. `COMPLETED`
  otherwise — including the empty-result case (zero jobs discovered) and
  the case where every processed job's own Resume QA legitimately returned
  `FAIL`/`REVIEW_REQUIRED` (a normal returned outcome, not a per-job
  failure).

## What triggers what

- n8n is the trigger and scheduler. It calls this service's endpoints for
  each stage (or the whole pipeline, depending on how future phases wire
  it up) rather than this service polling job boards on its own.
- Notification delivery (step 10) uses WhatsApp (Meta Cloud API), configured
  via `WHATSAPP_API_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` /
  `WHATSAPP_RECIPIENT_NUMBER`. Email/Telegram env vars still exist from the
  original scaffold but are not wired to anything.

## Current state

Steps 2–10 of the pipeline are implemented, and step 1 through step 10 are
now callable end-to-end via one HTTP request, `POST /career/run` (Phase 8).
No n8n workflow definition exists yet (out of scope for Phase 8 by design —
see `docs/AGENTS.md` → Orchestration API), and there is still no file
persistence for generated packages. See the root `README.md` for what to
build next.
