# Deployment

This project runs the exact same code locally and on Vercel — the same
`src/index.ts` entry point, calling the same `createApp()` factory
(`src/api/app.ts`). Every route, every piece of business logic, and every
security control is identical in both places. Nothing described here
changes route behavior, authentication, or the pipeline itself.

> **Revision note:** an earlier version of this doc described a separate
> `api/index.ts` serverless function plus a `vercel.json` catch-all
> rewrite. That combination caused every route — including `/health` — to
> return Vercel's own `404 NOT_FOUND` in production, because it mixed two
> incompatible Vercel mechanisms (see Architecture below). Both files have
> been removed; this doc now describes the corrected, zero-config setup.

## Local development

Unchanged from every earlier phase:

```bash
npm install
cp .env.example .env   # fill in your own keys, never commit this file
npm run dev
```

`npm run dev` runs `src/index.ts`, which calls `createApp()` and then
`app.listen(env.port)` (default port 3000). Health check:
`GET http://localhost:3000/health`.

## Vercel deployment

### Architecture

This project relies entirely on Vercel's built-in, current, zero-config
**Express** framework support ([docs](https://vercel.com/docs/frameworks/backend/express))
— no custom `api/` directory and no `vercel.json` are used or needed.

Vercel detects an Express app to deploy by looking for a file at one of a
fixed set of conventional locations — `app.*` / `index.*` / `server.*`,
at the project root or under `src/` — that either default-exports the
Express app or calls `app.listen()`. **`src/index.ts` already satisfies
this exactly** (it's at the recognized location and uses the `app.listen()`
"port listener" pattern) — it required **zero changes** to become the
Vercel entry point, because it already was a valid one.

When it detects this, Vercel wraps the *entire* Express app as a single
Vercel Function and routes every incoming path to it — `/health`,
`/jobs/analyze`, `/jobs/discover`, `/career/run`, all of it — with the
app's own internal Express routing (`src/api/app.ts`) deciding what
happens from there, identical to how it behaves locally. `app.listen()`
still runs, but Vercel manages the actual request lifecycle around it; you
don't need to reason about that distinction, since it's Vercel's internal
implementation, not something this codebase does anything special for.

**What was removed and why:** a previous revision of this project added a
manually-authored `api/index.ts` (importing `createApp()` and exporting
the Express app directly) plus a `vercel.json` catch-all rewrite
(`"/(.*)" → "/api"`), based on the older, generic "put a function under
`/api`" convention. That convention is for individual Web-Handler-style
functions (`export function GET(request: Request)`), not a full
self-routing Express app, and it doesn't collapse `api/index.ts` to the
path `/api` the way the rewrite assumed. Layering it on top of an
already-zero-config-compatible `src/index.ts` caused a routing conflict:
Vercel's build succeeded (`READY`), but no path resolved to a working
function, so every request fell through to Vercel's platform-level `404`.
The fix was to delete both files, not to correct the rewrite — the
zero-config path was already correct and needed no configuration at all.

No build step is required specifically for Vercel: its Node.js builder
compiles `src/index.ts` (and everything it imports) directly from
TypeScript source at deploy time. The project's own `npm run build`
(`tsc -p tsconfig.json`) is unrelated to this — it still only produces the
`node dist/index.js` build artifact and continues to pass unchanged.

### Deployment requirements

- A Vercel project pointed at this repository (or this subdirectory, if
  deployed from a monorepo) — **the Vercel project's Root Directory
  setting must point at `career-job-agent`** if the connected Git
  repository's actual root is one level above it (verify in Vercel
  Project Settings → General → Root Directory). If Root Directory is
  wrong, Vercel won't find `package.json`/`src/index.ts` at all, which
  produces the same blanket-404 symptom as the routing bug this doc
  describes — check this first if `/health` still 404s after the fix
  above is deployed.
- No project-level Build Command override is required — Vercel's Express
  framework detection is automatic (zero-config).
- Node.js 18+ (already declared in `package.json` → `engines`).
- All required environment variables set in the Vercel project's
  **Settings → Environment Variables** (see below) — never committed to
  the repo, never hardcoded in source.

### Environment variables

Set these in the Vercel dashboard (Production and/or Preview, as needed).
All are read from `process.env` via `src/config/env.ts`, exactly as
locally — nothing Vercel-specific was added to how they're read.

| Variable | Required for | Notes |
|---|---|---|
| `CLAUDE_API_KEY` | Job matching, resume tailoring, Evidence Guard, Resume QA, Application Package | Without it, `/career/run` still runs but returns `status: "FAILED"` once jobs are found and Claude is needed — see `docs/AGENTS.md`. |
| `CAREER_AGENT_API_KEY` | Authenticating `POST /career/run` | **Required for the endpoint to accept any request at all.** If unset, every request gets `503 Orchestration API is not configured` — the endpoint fails closed, never open. Generate a long random secret; never reuse it elsewhere. |
| `WHATSAPP_PROVIDER` | WhatsApp notifications | Set to `whatsapp-cloud-api`. Only consulted when `sendWhatsApp: true` and `dryRun: false` are both explicitly passed to `/career/run`. |
| `WHATSAPP_API_TOKEN` | WhatsApp notifications | Meta WhatsApp Business Cloud API token. |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp notifications | Meta Cloud API sending number ID. |
| `WHATSAPP_RECIPIENT_NUMBER` | WhatsApp notifications | E.164 format, e.g. `+923001234567`. |
| `REMOTIVE_MIN_FETCH_INTERVAL_HOURS` | Job discovery throttle | Optional, defaults to `6` if unset. |

`PORT` doesn't need to be set on Vercel — `src/index.ts` still calls
`app.listen(env.port)` there (Vercel's Express support explicitly expects
that pattern), but Vercel manages the actual request routing around it
regardless of which port value is used, so the default (3000) is fine to
leave as-is.

Never hardcode `CLAUDE_API_KEY` or `CAREER_AGENT_API_KEY` anywhere in
source — both are read exclusively from `process.env` at request time
(`CLAUDE_API_KEY` via `createClaudeClient()`; `CAREER_AGENT_API_KEY` via
`src/api/routes/careerRun.ts`).

### API endpoint

Once deployed, the app is reachable at your Vercel project's domain with
the **same paths as local dev** — Vercel routes every path directly into
the single Express Function, so nothing is prefixed with `/api` and no
rewrite is needed to achieve that:

```
https://<your-vercel-domain>/health
https://<your-vercel-domain>/jobs/analyze
https://<your-vercel-domain>/jobs/discover
https://<your-vercel-domain>/career/run
```

> **Read this before deploying.** Because Vercel deploys the *entire*
> Express app as one Function, `/jobs/analyze` and `/jobs/discover` —
> which have **no authentication**, by design, as localhost-only
> endpoints — become publicly reachable too, not just `/career/run`. This
> is unchanged code, just newly-public exposure once deployed. See
> `docs/SECURITY.md` → API exposure for the full explanation and
> mitigation options (Vercel Deployment Protection, or give those two
> routes their own auth before deploying somewhere they'll actually be
> used). This document does not silently work around that — it's called
> out here deliberately.

`POST /career/run` keeps every existing control unchanged:

- **Authentication:** `Authorization: Bearer <CAREER_AGENT_API_KEY>`
  required on every request — 401 if missing/wrong, 503 if the server has
  no key configured at all.
- **Default behavior:** `dryRun` defaults to `true` and `sendWhatsApp`
  defaults to `false`. The full pipeline (discovery → matching → tailoring
  → Evidence Guard → Resume QA → Application Package) still runs either
  way; only the WhatsApp send is gated, and only when both flags are
  explicitly overridden.
- **No automatic application submission** — this remains structurally
  impossible (`applicationStatus` can only ever be `READY_FOR_REVIEW`),
  unaffected by where the code runs.
- **Idempotency:** the `Idempotency-Key` header still works, backed by the
  same in-memory store — see the Known Limitation below.

### Verifying the entry point locally before deploying

```bash
npm run verify:vercel
```

`tests/integration/vercelEntry.manual.ts` runs `src/index.ts` — the exact
file Vercel deploys — as a real child process (not an in-repo mock),
confirms `GET /health` returns `200`, confirms `POST /career/run` still
requires authentication, then shuts it down. Not run by `npm test`
(excluded by Vitest's `tests/**/*.test.ts` glob), same as the other
`tests/integration/*.manual.ts` scripts.

### How n8n should call the endpoint

Point the existing n8n workflow's HTTP Request node at the deployed URL
instead of `http://localhost:3000` — nothing about the request shape
changes:

```
POST https://<your-vercel-domain>/career/run
Authorization: Bearer <CAREER_AGENT_API_KEY>
Content-Type: application/json
Idempotency-Key: <a value unique to this trigger run>

{
  "maxJobs": 20,
  "topJobs": 5,
  "sendWhatsApp": false,
  "dryRun": true
}
```

- Store `CAREER_AGENT_API_KEY` as an n8n credential/environment variable,
  not typed directly into the node — treat it the same as any other
  secret n8n holds.
- Send a fresh `Idempotency-Key` per logical run (e.g. derived from the
  trigger's timestamp or execution ID) so a retried HTTP call from n8n
  doesn't re-run the whole pipeline.
- Leave `dryRun: true` until you've reviewed a few runs' output. Only set
  `dryRun: false` and `sendWhatsApp: true` once you're ready for real
  WhatsApp notifications — nothing about this default changed for Vercel.
- This document does not change, and was not written to change, the n8n
  workflow itself — only the URL the existing HTTP Request node should
  point to.

### Known limitation carried over from Phase 8

The `Idempotency-Key` cache and the Remotive fetch throttle
(`REMOTIVE_MIN_FETCH_INTERVAL_HOURS`) are both in-memory (a `Map` inside
the running process). On Vercel, each serverless invocation may run in a
fresh execution environment — a "warm" invocation reuses the same process
and thus the same in-memory cache, but there is no guarantee two
back-to-back requests land on the same warm instance. In practice this
means idempotency protection and the discovery throttle are best-effort on
Vercel, not a hard guarantee, exactly as they were already documented as
best-effort/single-process in `docs/SECURITY.md` even before this change.
If this needs to be a hard guarantee, a shared store (e.g. Vercel KV/Redis)
would be required — not implemented here, since it isn't needed for a
single personal-use n8n caller and would add a dependency this phase
doesn't need.
