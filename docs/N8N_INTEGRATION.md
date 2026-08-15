# n8n Integration — Granular Career Pipeline Endpoints (Phase 8.2)

## Why this exists

`POST /career/run` holds one HTTP request open for the entire pipeline —
Job Discovery → Filtering → Claude Matching → Ranking → (Resume Tailoring →
Evidence Guard → Resume QA → Application Package) × every top job. For any
realistic job count this exceeds Vercel's serverless function duration
limit, which is what produced the "Gateway timed out" failures n8n was
seeing. See the Phase 8.1 design report (referenced in git history) for the
full feasibility analysis of why a naive `202 + background processing + GET
polling` design is **not** safely implementable on this deployment without
adding persistent infrastructure (a database/queue) — which was explicitly
out of scope.

Phase 8.2 implements the recommended alternative instead: break the single
long-running request into smaller, fully synchronous operations that n8n
itself orchestrates by looping. Every individual HTTP call now does *one
manageable unit of work* — either "discover and rank jobs" or "process one
job" — and stays comfortably within Vercel's timeout regardless of how many
jobs a run finds, because processing more jobs just means n8n makes more
(still-small) calls, not one giant one.

**No business logic changed.** Both new endpoints call the exact same
existing services (`discoverJobs`, `tailorResumeForJob`,
`verifyResumeEvidenceReport`, `reviewResume`, `generateApplicationPackage`)
that `POST /career/run` already used — they're thin orchestration wrappers,
not reimplementations.

---

## The two new endpoints

### `POST /career/discover-match`

Runs Job Discovery → Normalize → Deduplicate → Deterministic Filtering →
Claude Job Matching → Ranking → Top N, then stops (no resume work at all).

**Auth:** `Authorization: Bearer <CAREER_AGENT_API_KEY>` — same key,
same check, as `/career/run` (see Authentication below).

**Request:**

```json
{ "maxJobs": 10, "topJobs": 5 }
```

Both fields optional; defaults shown above. `maxJobs` caps how many
deterministically-eligible jobs are sent to Claude for matching (cost
control); `topJobs` caps how many ranked matches are returned.

**Response:**

```json
{
  "status": "COMPLETED | PARTIAL | FAILED",
  "jobsDiscovered": 10,
  "jobsAfterFiltering": 8,
  "jobsMatched": 5,
  "matchingFailures": 0,
  "topJobs": [
    {
      "jobId": "...",
      "jobTitle": "...",
      "company": "...",
      "location": "...",
      "source": "...",
      "sourceUrl": "...",
      "matchScore": 88,
      "interviewPotential": 70,
      "careerGrowth": 60,
      "futureAIValue": 75,
      "recommendation": "APPLY",
      "jobData": { "job": { ... }, "match": { ... } }
    }
  ]
}
```

`topJobs` is already sorted best-first (by `careerScore`, matching the
existing deterministic ranking logic) — taking the first N entries is
taking the best N.

**Status logic** (same shape as the Phase 6.1 fix applied to `/career/run`):
`FAILED` when every eligible job failed to match; `PARTIAL` when some
matched and some failed; `COMPLETED` otherwise (including when zero jobs
were discovered at all — nothing to process is not a failure).

**Why each `topJobs` entry carries a `jobData` field.** This is the one
deliberate addition beyond the minimal summary fields. No persistent or
shared store was added in this phase (explicitly out of scope), and Phase
8.1 already established that Vercel does not guarantee a later request
lands on the same instance that handled an earlier one — so a `jobId`-only
design for `/career/process-job`, relying on server-side in-memory lookup,
would be exactly the kind of "fake" solution that silently breaks in
production. Instead, the caller (n8n) is the state carrier between the two
calls: `jobData` is the already-public job posting plus the
already-computed match, round-tripped unmodified into `/career/process-job`
for whichever jobs n8n decides to process further. It never contains
resume, career profile, or prompt content.

---

### `POST /career/process-job`

Runs Resume Tailoring → Evidence Guard → Resume QA → Application Package
for **one** already-matched job.

**Auth:** same `CAREER_AGENT_API_KEY` bearer check.

**Request:**

```json
{
  "jobId": "...",
  "resumeProcessing": true,
  "jobData": { "job": { ... }, "match": { ... } }
}
```

`jobData` must be exactly what `/career/discover-match` returned for this
job (see above). `jobId` is cross-checked against `jobData.job`'s own
identifier — a mismatch is a `400`, not a silently-wrong job being
processed.

**Response:**

```json
{
  "status": "COMPLETED | PARTIAL | FAILED",
  "jobId": "...",
  "company": "...",
  "jobTitle": "...",
  "resumeQAStatus": "PASS",
  "resumeQAOverallScore": 85,
  "applicationPackageCreated": true
}
```

**Status logic:**
- `COMPLETED` — all four stages ran and the application package was
  created (`applicationPackageCreated: true`).
- `PARTIAL` — all four stages ran without error, but Resume QA did not pass
  (`FAIL` or `REVIEW_REQUIRED`), so no submission-ready package exists.
  This is a legitimate, honest outcome — not a crash — same convention
  `/career/run`'s per-job loop already used.
- `FAILED` — one of the four stages actually threw (a Claude API error, a
  schema-validation failure, etc.). `resumeQAStatus` is `"NOT_REACHED"`
  when the failure happened before Resume QA ran. **Never returns `200`
  with `status: "COMPLETED"` for a failed operation.**

---

## Authentication

Both new endpoints reuse the *exact same* auth check `/career/run` already
used — extracted into one shared function
(`src/api/routes/careerAuth.ts`) so there is only ever one implementation,
not a second parallel one. Missing key → `401 "Missing API key"`; wrong key
→ `401 "Invalid API key"`; server has no key configured at all →
`503 "Orchestration API is not configured"`.

---

## Idempotency

Both endpoints accept an `Idempotency-Key` header, exactly like
`/career/run`, backed by the same `InMemoryIdempotencyStore` class
(generalized to be reusable across all three endpoints rather than
duplicated — see `careerOrchestrationService.ts`).

- `/career/discover-match`: one key per discovery run.
- `/career/process-job`: one key per job/opportunity.

**Known limitation — read this before relying on it.** This store is an
in-memory `Map` inside one server process. Vercel does not guarantee that a
retried request lands on the same warm instance as the original request —
if it doesn't, the duplicate is **not** caught, and the stage/run is
silently re-executed, incurring duplicate Claude spend. This is a
pre-existing gap (it already existed for `/career/run`), not something
newly introduced or newly claimed to be fixed here. It's real and worth
knowing about, but closing it fully requires a shared/persistent store,
which was explicitly not added in this phase. Practically: the smaller
each granular call is, the smaller the blast radius of a duplicate — one
job's 4-call chain, not a whole multi-job pipeline.

---

## `POST /career/run` — unchanged, still available

`/career/run` was **not removed or modified in behavior** and remains
available for backward compatibility. It does **not** internally call the
new endpoints (which would just create duplicate processing of the same
work) — it still runs its own original, unchanged synchronous pipeline.

**New n8n workflows should use the granular endpoints below instead of
`/career/run`**, specifically to avoid the timeout `/career/run` is prone
to for any realistic job count. `/career/run` remains suitable only for
very small, quick test runs (e.g., `maxJobs`/`topJobs` = 1) where the whole
pipeline reliably finishes well inside Vercel's limit.

---

## Future n8n workflow sequence

*(Documentation only — the actual n8n workflow has not been modified as
part of this phase.)*

```
POST /career/discover-match   { maxJobs: 10, topJobs: 5 }
        ↓
Receive up to 5 ranked topJobs (best-first)
        ↓
Take the first `resumeTopJobs` (e.g. 2) — do NOT send all 5 to resume processing;
that reintroduces the same "too much work in too little wall-clock time" pattern
this phase exists to avoid.
        ↓
LOOP over those 2 jobs:
    POST /career/process-job   { jobId, resumeProcessing: true, jobData }
        ↓
    Collect results where applicationPackageCreated === true
        ↓
AFTER the loop:
    Upload successful application packages → Google Drive
    Record run summary → Google Sheets
    Optional: WhatsApp notification for the successful opportunities
```

Recommended defaults: `maxJobs = 10`, `topJobs = 5`, `resumeTopJobs = 2` —
`resumeTopJobs` is purely an n8n-side loop bound (how many of the returned
`topJobs` array n8n chooses to send onward); it is not a parameter the
server needs to know about, since discover-match already returns the full
ranked list and n8n decides how much of it to act on.

**On `FAILED`** (from either endpoint): stop and report — do not retry
blindly with a new `Idempotency-Key` (that defeats the point of having one)
and do not proceed to the next job assuming partial state is safe to build
on.

**On `PARTIAL`** (from `/career/process-job`): the job was evaluated
honestly and didn't pass QA — this is not an error to alert on, just a job
with no package to collect. Continue the loop.

**On `COMPLETED`**: collect the result normally.
