# career-job-agent

Personal AI Career Agent — foundation phase.

This project will eventually find suitable jobs, evaluate them against a
personal profile, select the best opportunities, tailor a resume, QA the
result, assemble an application package, and notify the user for manual
review and application.

**Status: Phase 8 complete.** The full pipeline — job discovery through
resume tailoring, QA, and WhatsApp notification — is now callable in a
single request: `POST /career/run` (`src/api/routes/careerRun.ts`), the
endpoint n8n calls. It requires `Authorization: Bearer <CAREER_AGENT_API_KEY>`,
defaults to `dryRun=true`/`sendWhatsApp=false` (never sends anything unless
both are explicitly overridden), supports an `Idempotency-Key` header to
prevent accidental duplicate runs, and can never submit an application —
that remains structurally impossible. It reuses every existing service as-is:
**Job Discovery** (`POST /jobs/discover` pulls live postings from
**Remotive**, a free keyless public API, and feeds them into the
**existing, unmodified** Phase 2 pipeline — deterministic filtering →
Claude-based job matching → deterministic ranking → top 5; `POST
/jobs/analyze` still works standalone for manually-supplied job JSON),
Claude-based **Resume Tailoring** (`resumeTailoringService.ts`), an
independent **Evidence Guard** that cross-checks every free-text claim
against the real source material (`resumeEvidenceService.ts`), an
independent **Resume QA** review that trusts neither of the previous two
steps (`resumeQAService.ts`, returning `PASS`/`FAIL`/`REVIEW_REQUIRED`), an
**Application Package** step (`applicationPackageService.ts`) that only
assembles a package when QA returned `PASS`, and **WhatsApp notification
delivery** (`src/notifications/`, via the official Meta WhatsApp Business
Cloud API) sending a deterministic digest — no Claude call — summarizing
only the packages that reached `READY_FOR_REVIEW`; nothing is ever
auto-marked `APPLIED`. The n8n workflow definition itself, and writing
packages to `applications/`, do not exist yet.

Deployable to Vercel as a serverless function (`api/index.ts`) with zero
change to route behavior, auth, or the pipeline itself — see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the planned system
design and [`docs/WORKFLOW.md`](docs/WORKFLOW.md) for the intended pipeline.

## Stack

- Node.js + TypeScript
- Express (minimal API surface)
- Claude API (`@anthropic-ai/sdk`) — reasoning and semantic analysis only
- Zod — validation of all AI output
- Vitest — testing
- n8n — orchestration (external, not yet wired up)

## Getting started

```bash
npm install
cp .env.example .env   # fill in your own keys, never commit this file
npm run dev
```

Health check: `GET http://localhost:3000/health`

## Deploying to Vercel

`npm run dev` (above) is still the local flow — nothing about it changed.
For deploying to Vercel, see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for
the required environment variables, the `POST /career/run` URL structure,
and how to point the existing n8n workflow at the deployed endpoint. This
project was not deployed as part of adding Vercel support — that step is
left to you.

## Scripts

| Script              | Purpose                              |
|----------------------|---------------------------------------|
| `npm run dev`        | Run the app with hot reload           |
| `npm run build`      | Compile TypeScript to `dist/`         |
| `npm run test`       | Run the test suite once               |
| `npm run test:watch` | Run tests in watch mode               |
| `npm run test:claude`| Manual, real Claude API call (job matching) — requires `CLAUDE_API_KEY` |
| `npm run test:claude:resume` | Manual, real Claude API call (resume tailoring) |
| `npm run test:claude:resume-qa` | Manual, real Claude API call (full tailoring → evidence guard → QA chain) |
| `npm run test:claude:application` | Manual, real Claude API call (full job match → tailoring → evidence guard → QA → package chain) |
| `npm run test:jobs:live` | Manual, real (read-only, no key needed) Remotive job search |
| `npm run test:whatsapp` | Manual, real WhatsApp test notification — requires `WHATSAPP_*` credentials |
| `npm run test:career:live` | Manual, real end-to-end orchestration run — requires `CLAUDE_API_KEY`; always dryRun/no WhatsApp |
| `npm run verify:vercel` | Manual, imports `api/index.ts` (the Vercel entry point) and confirms `GET /health` → 200 |
| `npm run lint`       | Lint the codebase                     |

See `docs/TESTING.md` for details on all manual integration scripts.

## Project layout

```
api/
  index.ts    Vercel serverless entry point (no app.listen — see docs/DEPLOYMENT.md)
src/
  index.ts    Local-dev entry point (calls app.listen)
  api/        HTTP layer (Express routes), shared by both entry points above
  services/   External integrations (Claude, n8n, notifications)
  jobSources/ External job provider abstraction + implementations (Phase 6)
  notifications/ Notification provider abstraction + WhatsApp implementation (Phase 7)
  agents/     Agent orchestration logic
  prompts/    Claude prompt templates
  schemas/    Zod schemas for validating AI output
  ranking/    Deterministic scoring/ranking logic
  config/     Environment and configuration
  utils/      Shared helpers
tests/        Vitest test suites
profile/      Your career profile, master resume, job preferences
resumes/      Generated tailored resumes (gitignored)
applications/ Generated application packages (gitignored)
docs/         Architecture, workflow, security, and deployment documentation
vercel.json   Minimal Vercel routing config (rewrites all paths to api/index.ts;
              Framework Preset must be "Other" — see docs/DEPLOYMENT.md)
```

## Before you continue

Fill in the placeholders in:

- [`profile/career_profile.md`](profile/career_profile.md)
- [`profile/master_resume.md`](profile/master_resume.md)
- [`profile/job_preferences.md`](profile/job_preferences.md)

These files are the only source of truth for anything about you — see
[`CLAUDE.md`](CLAUDE.md) for the rules that govern how this project uses
that data.

## Project rules

This project follows a strict set of rules (no invented experience, no
automated application submission, human approval required, etc.) — see
[`CLAUDE.md`](CLAUDE.md) for the full list.
