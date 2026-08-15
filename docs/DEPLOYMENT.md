# Deployment

This project runs two ways from the exact same code: locally with
`app.listen()`, and on Vercel as a serverless function with no listener at
all. Both entry points call the same `createApp()` factory
(`src/api/app.ts`) — every route, every piece of business logic, and every
security control is identical in both places. Nothing described here
changes route behavior, authentication, or the pipeline itself.

> **Revision history (read this if anything here seems inconsistent with
> what you remember):** this project's Vercel setup has gone through two
> approaches.
> 1. Originally: `api/index.ts` + a `vercel.json` catch-all rewrite. This
>    produced a blanket `404 NOT_FOUND` on every route in production.
> 2. We then switched to Vercel's newer zero-config Express support (no
>    `api/`, no `vercel.json` — just `src/index.ts` auto-detected). Locally
>    this verified correctly, but in actual production deployment it hit a
>    **build-time crash inside Vercel's own tooling** —
>    `Error: Cannot read properties of undefined (reading 'fsPath')`,
>    thrown immediately when `vercel build` starts, before any project
>    file is processed. This looks like a bug in Vercel's Express
>    auto-detector itself (a very recently released feature), not
>    something fixable from this codebase.
> 3. **Current state: back to `api/index.ts` + `vercel.json`** (approach
>    1), because it's the older, far more battle-tested code path on
>    Vercel. The one thing that's different this time: we've now confirmed
>    the Vercel project's **Root Directory** setting is correctly `./`,
>    which was never actually verified during the original 404 — it's
>    possible that was a contributing factor the first time around, not a
>    problem with this approach itself. If this combination still fails
>    once Root Directory and Framework Preset (see below) are both
>    correct, that's new information worth capturing here.

## Local development

Unchanged from every earlier phase:

```bash
npm install
cp .env.example .env   # fill in your own keys, never commit this file
npm run dev
```

`npm run dev` runs `src/index.ts`, which calls `createApp()` and then
`app.listen(env.port)` (default port 3000). This is the **only** place in
the codebase that calls `app.listen()`. Health check:
`GET http://localhost:3000/health`.

## Vercel deployment

### Architecture

Vercel does not run a long-lived server for this project — it builds one
serverless function per request path in `/api` and invokes it per request.
This project has exactly one such function:

- **`api/index.ts`** — imports `createApp()` from `src/api/app.ts` and
  exports the resulting Express app as the default export. Vercel's
  Node.js runtime calls a default-exported `(req, res)` handler directly,
  and an Express app already has that exact shape — no adapter code, no
  extra dependency. It does **not** call `app.listen()`; Vercel owns the
  HTTP server and process lifecycle.
- **`vercel.json`** — a single catch-all rewrite:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/api" }] }
  ```
  Without this, Vercel's file-system routing would only serve requests to
  the literal path `/api` (since `api/index.ts` is the only function).
  The rewrite forwards every path — `/health`, `/jobs/analyze`,
  `/jobs/discover`, `/career/run` — to that one function, which then does
  its own internal routing exactly as it does locally. The original
  request path is preserved; nothing is prefixed with `/api` for callers.

**Important — the Vercel project's Framework Preset must be set to
"Other"**, not "Express". "Express" activates the newer zero-config
detector described in the revision history above, which currently crashes
at build time on this project. "Other" uses the plain `/api` Serverless
Function builder instead, which is what actually runs `api/index.ts`.
(Settings → General → Framework Preset.)

No build step is required specifically for the API: Vercel's Node.js
builder compiles `api/index.ts` (and everything it imports from `src/`)
directly from TypeScript source at deploy time. The project's own
`npm run build` (`tsc -p tsconfig.json`, scoped to `src/**/*.ts` only) is
unaffected by this — it still only compiles the local-dev/production
(`node dist/index.js`) build and continues to pass unchanged.

### Deployment requirements

- A Vercel project pointed at this repository — **Root Directory** should
  be `./` (blank/default) since this repository's root *is* the project
  root (verify in Vercel Project Settings → General → Root Directory). If
  Root Directory is wrong, Vercel won't find `package.json`/`api/` at all,
  which produces the same blanket-404 symptom described above.
- **Framework Preset must be "Other"** (see Architecture above) — not
  "Express", which crashes the build on this project as of this writing.
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

`PORT` is **not needed on Vercel** — it only matters to `src/index.ts`'s
local `app.listen()` call, which never runs in the serverless entry point
(`api/index.ts`).

Never hardcode `CLAUDE_API_KEY` or `CAREER_AGENT_API_KEY` anywhere in
source, in `vercel.json`, or in `api/index.ts` — both are read exclusively
from `process.env` at request time (`CLAUDE_API_KEY` via
`createClaudeClient()`; `CAREER_AGENT_API_KEY` via
`src/api/routes/careerRun.ts`).

### API endpoint

Once deployed, the app is reachable at your Vercel project's domain with
the **same paths as local dev** — the rewrite in `vercel.json` strips the
`/api` implementation detail away:

```
https://<your-vercel-domain>/health
https://<your-vercel-domain>/jobs/analyze
https://<your-vercel-domain>/jobs/discover
https://<your-vercel-domain>/career/run
```

> **Read this before deploying.** `vercel.json`'s catch-all rewrite sends
> every path to the same function, so `/jobs/analyze` and `/jobs/discover`
> — which have **no authentication**, by design, as localhost-only
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

`tests/integration/vercelEntry.manual.ts` imports `api/index.ts` — the
exact file Vercel deploys — and drives it with Supertest, confirming
`GET /health` returns `200` and `POST /career/run` still requires
authentication. No child process or open port needed, since `api/index.ts`
never calls `app.listen()`. Not run by `npm test` (excluded by Vitest's
`tests/**/*.test.ts` glob), same as the other
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
