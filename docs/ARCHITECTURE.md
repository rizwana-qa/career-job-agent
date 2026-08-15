# Architecture (Planned)

> **Status: foundation phase.** Nothing described below beyond the `/health`
> endpoint and directory layout is implemented yet. This document records
> the intended design so future phases build toward a consistent shape.

## Overview

`career-job-agent` is a small TypeScript service, orchestrated externally by
n8n, that turns raw job listings into a small set of reviewed, tailored
application packages for a single user (not multi-tenant).

```
n8n  →  Job Source  →  Claude Job Matching  →  Top 5 Jobs
     →  Claude Resume Tailoring  →  Claude Resume QA
     →  Application Package  →  Email / Telegram  →  Human Approval
```

n8n owns scheduling and triggering. This service owns the logic: fetching
context, calling Claude, validating output, scoring, and producing files.

## Layers

- **`src/api/`** — Thin HTTP layer. n8n calls into this service via HTTP
  (webhooks/REST), rather than the service polling anything itself.
- **`src/agents/`** — Orchestration logic per pipeline stage (matching,
  tailoring, QA). Each agent is a coordinator: it gathers input, prompts
  Claude via `src/services/`, validates the response via `src/schemas/`,
  and hands off to the next stage.
- **`src/services/`** — External integrations: the Claude API client, n8n
  webhook calls, Telegram/email notification senders.
- **`src/prompts/`** — Prompt templates, kept separate from orchestration
  code so they can be iterated on independently.
- **`src/schemas/`** — Zod schemas that every Claude response is parsed
  through before the result is trusted or persisted.
- **`src/ranking/`** — Deterministic, non-AI scoring and ranking logic
  (e.g., salary threshold filtering, keyword overlap scoring). Claude is
  used for semantic judgment; plain code is used for anything that has a
  correct, computable answer.
- **`src/config/`** — Environment loading and configuration.
- **`src/utils/`** — Shared, stateless helpers.

## Data

- **`profile/`** — Hand-maintained source of truth: career profile, master
  resume, job preferences. Read-only from the application's perspective.
- **`resumes/`** — Generated, tailored resumes per job (gitignored, contains
  personal data).
- **`applications/`** — Generated application packages per job (gitignored,
  contains personal data).

No database exists in this phase. State is files on disk plus whatever n8n
holds between steps. A database may be introduced later if file-based state
becomes insufficient — not before.

## Explicit non-goals (this phase and near-term)

- No PostgreSQL or any database.
- No Next.js or web dashboard.
- No automated LinkedIn application submission.
- No automatic application submission of any kind — the pipeline always
  ends at human review.

## Why this shape

- **Simplicity first.** The full pipeline has many moving parts; building
  the scaffold first means each future phase (matching, tailoring, QA) can
  be implemented and tested in isolation against a stable base.
- **n8n as orchestrator, not this service.** Keeps scheduling/triggering
  concerns out of the TypeScript codebase.
- **Deterministic vs. AI split.** Anything with a checkable right answer
  (does this salary meet the minimum? does this job match a target
  country?) is plain code. Anything requiring language understanding
  (does this job description align with this person's experience?) goes
  through Claude, validated with Zod. See [`AGENTS.md`](AGENTS.md).
