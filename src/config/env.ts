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
  careerAgentApiKey: process.env.CAREER_AGENT_API_KEY
};
