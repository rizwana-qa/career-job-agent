# CLAUDE.md — Project Rules for career-job-agent

This file defines non-negotiable rules for any AI assistant (or human) working
on this codebase. These rules exist because this project handles a real
person's career data, job applications, and job search decisions.

## Core Rules

1. Never invent professional experience.
2. Never invent achievements.
3. Never invent technologies.
4. Never invent certifications.
5. Never invent salary information.
6. Never claim an estimated match score is an actual ATS score.
7. Use deterministic code for deterministic calculations.
8. Use Claude only for reasoning and semantic analysis.
9. Validate all AI output with Zod.
10. Never expose secrets.
11. Never commit credentials.
12. Never automate unauthorized LinkedIn activity.
13. Never bypass CAPTCHA, authentication, bot detection, or platform restrictions.
14. Human approval is required before application submission.
15. Keep the architecture simple.
16. Do not modify unrelated files.
17. Run tests after every implementation phase.
18. Never claim a feature is complete without testing it.

## Notes on applying these rules

- All content that describes the user (experience, skills, achievements,
  certifications, salary) must come from `profile/career_profile.md` and
  `profile/master_resume.md`, which are filled in by the user directly. AI
  agents may rephrase, summarize, or reformat this content, but must not add
  facts that are not present in the source.
- "Match score", "fit score", or similar outputs from job-matching logic are
  estimates of relevance, not certified ATS results. Label them as such
  wherever they are surfaced (logs, emails, application packages).
- Numeric scoring, ranking, and thresholding should be implemented as plain
  TypeScript logic (see `src/ranking/`), not delegated to the Claude API.
  Claude is used for tasks that require language understanding: matching job
  descriptions to profile semantics, tailoring resume language, and QA
  review of generated text.
- Every Claude API response that is consumed programmatically must be parsed
  through a Zod schema (see `src/schemas/`) before use.
- No step in this project submits a job application automatically. The
  pipeline ends at "application package ready + notification sent." A human
  reviews and applies manually.
