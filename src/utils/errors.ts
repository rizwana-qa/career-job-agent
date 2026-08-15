export class ClaudeNotConfiguredError extends Error {
  constructor(message = "Claude API is not configured") {
    super(message);
    this.name = "ClaudeNotConfiguredError";
  }
}

export class ClaudeApiError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ClaudeApiError";
  }
}

export class ClaudeTimeoutError extends ClaudeApiError {
  constructor(message = "Claude API request timed out") {
    super(message);
    this.name = "ClaudeTimeoutError";
  }
}

export class InvalidClaudeResponseError extends Error {
  constructor(message: string, readonly rawText?: string) {
    super(message);
    this.name = "InvalidClaudeResponseError";
  }
}

export class ClaudeResponseValidationError extends Error {
  constructor(message: string, readonly issues: string[]) {
    super(message);
    this.name = "ClaudeResponseValidationError";
  }
}

/** Input to a service was missing or unusable (e.g. no job, no master resume, no career profile). */
export class InvalidTailoringInputError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = "InvalidTailoringInputError";
  }
}

/** Input to the resume evidence guard was missing or unusable (no master resume, no career profile, or an invalid tailored resume). */
export class InvalidEvidenceInputError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = "InvalidEvidenceInputError";
  }
}

/** Input to the resume QA agent was missing or unusable (no job, no master resume, no career profile, invalid tailored resume, or invalid evidence guard result). */
export class InvalidQAInputError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = "InvalidQAInputError";
  }
}

/**
 * Input to the application package service was missing or unusable (no job,
 * no job match, no master resume, no career profile, invalid tailored
 * resume, or invalid resume QA result). This is distinct from a legitimate
 * FAIL/REVIEW_REQUIRED Resume QA outcome, which is a returned value, not a
 * thrown error — see src/services/applicationPackageService.ts.
 */
export class InvalidApplicationPackageInputError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = "InvalidApplicationPackageInputError";
  }
}

/** Base class for anything that goes wrong talking to an external job source (Phase 6). */
export class JobSourceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "JobSourceError";
  }
}

export class JobSourceTimeoutError extends JobSourceError {
  constructor(message = "Job source request timed out") {
    super(message);
    this.name = "JobSourceTimeoutError";
  }
}

export class JobSourceRateLimitError extends JobSourceError {
  constructor(message = "Job source rate limit exceeded") {
    super(message);
    this.name = "JobSourceRateLimitError";
  }
}

export class JobSourceAuthError extends JobSourceError {
  constructor(message = "Job source authentication failed") {
    super(message);
    this.name = "JobSourceAuthError";
  }
}

export class JobSourceUnavailableError extends JobSourceError {
  constructor(message = "Job source is unavailable") {
    super(message);
    this.name = "JobSourceUnavailableError";
  }
}

/** The job source returned a response that wasn't valid JSON or didn't match the expected shape. */
export class InvalidJobSourceResponseError extends Error {
  constructor(message: string, readonly rawBody?: string) {
    super(message);
    this.name = "InvalidJobSourceResponseError";
  }
}

/** Input to the job discovery service was missing or unusable (e.g. invalid search criteria). */
export class InvalidDiscoveryInputError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = "InvalidDiscoveryInputError";
  }
}

/** Raised when a notification provider is used before it's configured (e.g. missing WhatsApp credentials). */
export class NotificationNotConfiguredError extends Error {
  constructor(message = "Notification provider is not configured") {
    super(message);
    this.name = "NotificationNotConfiguredError";
  }
}

/** Base class for anything that goes wrong talking to an external notification provider (Phase 7). */
export class NotificationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "NotificationError";
  }
}

export class NotificationAuthError extends NotificationError {
  constructor(message = "Notification provider authentication failed") {
    super(message);
    this.name = "NotificationAuthError";
  }
}

export class NotificationRateLimitError extends NotificationError {
  constructor(message = "Notification provider rate limit exceeded") {
    super(message);
    this.name = "NotificationRateLimitError";
  }
}

export class NotificationUnavailableError extends NotificationError {
  constructor(message = "Notification provider is unavailable") {
    super(message);
    this.name = "NotificationUnavailableError";
  }
}

/** The configured recipient identifier is malformed (e.g. not E.164 format) — caught before any network call. */
export class InvalidRecipientError extends Error {
  constructor(message = "Invalid notification recipient") {
    super(message);
    this.name = "InvalidRecipientError";
  }
}

/** The notification provider returned a response that wasn't valid JSON or didn't match the expected shape. */
export class InvalidNotificationResponseError extends Error {
  constructor(message: string, readonly rawBody?: string) {
    super(message);
    this.name = "InvalidNotificationResponseError";
  }
}

/** Input to the career orchestration service (POST /career/run) was missing or unusable — e.g. malformed run options. */
export class InvalidOrchestrationInputError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = "InvalidOrchestrationInputError";
  }
}

/**
 * Reduces any thrown value to a safe, loggable message. Never include
 * request payloads (profile/job content) or API keys when calling this —
 * callers pass only the error itself, not surrounding context.
 */
export function toSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
