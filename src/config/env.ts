import "dotenv/config";

interface EnvConfig {
  port: number;
  claudeApiKey: string | undefined;
  n8nWebhookUrl: string | undefined;
  telegramBotToken: string | undefined;
  telegramChatId: string | undefined;
  /** Minimum hours between real Remotive API calls (Remotive's own guidance: max ~4/day — default is well within that). */
  remotiveMinFetchIntervalHours: number;
  /** Which notification provider is configured, e.g. "whatsapp-cloud-api". Reserved for future multi-provider dispatch (see src/notifications/notificationProvider.ts). */
  whatsappProvider: string | undefined;
  /** Meta WhatsApp Business Cloud API permanent/system-user access token. */
  whatsappApiToken: string | undefined;
  /** Meta WhatsApp Business Cloud API sending phone_number_id (not a phone number itself). */
  whatsappPhoneNumberId: string | undefined;
  /** The user's own WhatsApp number to notify, E.164 format (e.g. +923001234567). Never hardcoded. */
  whatsappRecipientNumber: string | undefined;
  /** Shared secret for POST /career/run (Authorization: Bearer <key>). Never hardcoded, never logged. */
  careerAgentApiKey: string | undefined;

  // --- Multi-source job discovery (Phase 8.4) ---
  // Enablement flags only gate POST /career/discover-match's source registry
  // (src/jobSources/jobSourceRegistry.ts) — /career/run and /jobs/discover
  // are untouched and always use their own single Remotive source directly
  // (unaffected by this flag either way).
  /** Defaults to disabled as of Phase 8.5.1 — see the Phase 8.5.1 production source flags note below. */
  jobSourceRemotiveEnabled: boolean;
  /** Defaults to disabled — see docs/JOB_SOURCES.md; no documented public API exists yet. */
  jobSourceIndeedEnabled: boolean;
  /** Defaults to disabled — see docs/JOB_SOURCES.md; no documented public API exists yet. */
  jobSourceNaukrigulfEnabled: boolean;
  /** Defaults to disabled — see docs/JOB_SOURCES.md; no documented public API exists yet. */
  jobSourceGulfTalentEnabled: boolean;
  /** Placeholder credential — unused until a documented Indeed access method exists. Never hardcoded. */
  indeedApiKey: string | undefined;
  /** Placeholder credential — unused until a documented Naukrigulf access method exists. Never hardcoded. */
  naukrigulfApiKey: string | undefined;
  /** Placeholder credential — unused until a documented GulfTalent access method exists. Never hardcoded. */
  gulfTalentApiKey: string | undefined;

  // --- Final source stack (Phase 8.5, production defaults set in Phase 8.5.1) ---
  // Phase 8.5.1: Himalayas and Remote OK are now the production-default
  // PRIMARY sources; Remotive, Careerjet, Jobicy, Jooble, and We Work
  // Remotely all default to disabled. This is a config-only change — no
  // adapter, filtering, matching, ranking, or n8n-contract code was touched.
  /** Defaults to enabled as of Phase 8.5.1 — production primary source. */
  jobSourceHimalayasEnabled: boolean;
  /** Defaults to enabled as of Phase 8.5.1 — production primary source. */
  jobSourceRemoteOkEnabled: boolean;
  /** Requires CAREERJET_API_KEY, which is not configured — see docs/JOB_SOURCES.md. */
  jobSourceCareerjetEnabled: boolean;
  jobSourceJobicyEnabled: boolean;
  /** Requires JOOBLE_API_KEY, which is not configured — see docs/JOB_SOURCES.md. */
  jobSourceJoobleEnabled: boolean;
  jobSourceWweRemotelyEnabled: boolean;
  /** Careerjet partner API key + affiliate id. Placeholder — read from process.env only, never hardcoded. */
  careerjetApiKey: string | undefined;
  careerjetAffiliateId: string | undefined;
  /** Jooble REST API key. Placeholder — read from process.env only, never hardcoded, never sent anywhere but Jooble's own endpoint. */
  joobleApiKey: string | undefined;
}

/** Parses an env var as a boolean flag: "true"/"1" (case-insensitive) => true, anything else (including unset) => the default. */
function parseBooleanFlag(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined) {
    return defaultValue;
  }
  return raw.trim().toLowerCase() === "true" || raw.trim() === "1";
}

export const env: EnvConfig = {
  port: Number(process.env.PORT ?? 3000),
  claudeApiKey: process.env.CLAUDE_API_KEY,
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  remotiveMinFetchIntervalHours: Number(process.env.REMOTIVE_MIN_FETCH_INTERVAL_HOURS ?? 6),
  whatsappProvider: process.env.WHATSAPP_PROVIDER,
  whatsappApiToken: process.env.WHATSAPP_API_TOKEN,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  whatsappRecipientNumber: process.env.WHATSAPP_RECIPIENT_NUMBER,
  careerAgentApiKey: process.env.CAREER_AGENT_API_KEY,
  jobSourceRemotiveEnabled: parseBooleanFlag(process.env.JOB_SOURCE_REMOTIVE_ENABLED, false),
  jobSourceIndeedEnabled: parseBooleanFlag(process.env.JOB_SOURCE_INDEED_ENABLED, false),
  jobSourceNaukrigulfEnabled: parseBooleanFlag(process.env.JOB_SOURCE_NAUKRIGULF_ENABLED, false),
  jobSourceGulfTalentEnabled: parseBooleanFlag(process.env.JOB_SOURCE_GULFTALENT_ENABLED, false),
  indeedApiKey: process.env.INDEED_API_KEY,
  naukrigulfApiKey: process.env.NAUKRIGULF_API_KEY,
  gulfTalentApiKey: process.env.GULFTALENT_API_KEY,
  jobSourceHimalayasEnabled: parseBooleanFlag(process.env.JOB_SOURCE_HIMALAYAS_ENABLED, true),
  jobSourceRemoteOkEnabled: parseBooleanFlag(process.env.JOB_SOURCE_REMOTEOK_ENABLED, true),
  jobSourceCareerjetEnabled: parseBooleanFlag(process.env.JOB_SOURCE_CAREERJET_ENABLED, false),
  jobSourceJobicyEnabled: parseBooleanFlag(process.env.JOB_SOURCE_JOBICY_ENABLED, false),
  jobSourceJoobleEnabled: parseBooleanFlag(process.env.JOB_SOURCE_JOOBLE_ENABLED, false),
  jobSourceWweRemotelyEnabled: parseBooleanFlag(process.env.JOB_SOURCE_WWR_ENABLED, false),
  careerjetApiKey: process.env.CAREERJET_API_KEY,
  careerjetAffiliateId: process.env.CAREERJET_AFFILIATE_ID,
  joobleApiKey: process.env.JOOBLE_API_KEY
};
