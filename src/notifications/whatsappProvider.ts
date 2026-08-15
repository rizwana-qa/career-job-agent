import type { NotificationMessage, NotificationProvider, NotificationResult } from "./notificationProvider.js";
import { env } from "../config/env.js";
import {
  InvalidNotificationResponseError,
  InvalidRecipientError,
  NotificationAuthError,
  NotificationError,
  NotificationNotConfiguredError,
  NotificationRateLimitError,
  NotificationUnavailableError
} from "../utils/errors.js";

const WHATSAPP_API_VERSION = "v21.0";
const REQUEST_TIMEOUT_MS = 10_000;
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export interface WhatsAppProviderOptions {
  apiToken?: string;
  phoneNumberId?: string;
  recipientNumber?: string;
  /** Injectable for tests — defaults to the global fetch (Node 18+ built-in, no new dependency). */
  fetchImpl?: typeof fetch;
}

interface WhatsAppSuccessResponse {
  messages?: Array<{ id?: string }>;
}

interface WhatsAppErrorResponse {
  error?: { message?: string; code?: number };
}

function isWhatsAppSuccessResponse(value: unknown): value is WhatsAppSuccessResponse {
  return typeof value === "object" && value !== null;
}

/**
 * Meta WhatsApp Business Platform — Cloud API (official, direct from Meta —
 * see docs/AGENTS.md -> Notifications for why this was selected over a BSP
 * like Twilio). Sends a single text message per call; no interactive
 * buttons, no approval callbacks — delivery only, per the Phase 7 spec.
 *
 * Real-world note: Meta requires business-initiated messages to use a
 * pre-approved Message Template unless sent within 24 hours of the
 * recipient last messaging the business number. This provider sends plain
 * `type: "text"` messages, which only succeed within that 24h session
 * window — see docs/AGENTS.md for the operational implication.
 */
export function createWhatsAppProvider(options: WhatsAppProviderOptions = {}): NotificationProvider {
  const apiToken = options.apiToken ?? env.whatsappApiToken;
  const phoneNumberId = options.phoneNumberId ?? env.whatsappPhoneNumberId;
  const recipientNumber = options.recipientNumber ?? env.whatsappRecipientNumber;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "whatsapp-cloud-api",

    async sendNotification(message: NotificationMessage): Promise<NotificationResult> {
      if (!apiToken || !phoneNumberId || !recipientNumber) {
        throw new NotificationNotConfiguredError(
          "WhatsApp is not configured — WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_RECIPIENT_NUMBER must all be set"
        );
      }

      if (!E164_PATTERN.test(recipientNumber)) {
        throw new InvalidRecipientError("WHATSAPP_RECIPIENT_NUMBER must be in E.164 format, e.g. +923001234567");
      }

      const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: recipientNumber,
            type: "text",
            text: { body: message.text }
          }),
          signal: controller.signal
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new NotificationUnavailableError("WhatsApp request timed out");
        }
        throw new NotificationUnavailableError(
          `WhatsApp is unavailable: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        clearTimeout(timeout);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new InvalidNotificationResponseError("WhatsApp response was not valid JSON");
      }

      if (response.status === 401 || response.status === 403) {
        throw new NotificationAuthError(
          `WhatsApp authentication failed (HTTP ${response.status}): ${(body as WhatsAppErrorResponse)?.error?.message ?? "no detail"}`
        );
      }
      if (response.status === 429) {
        throw new NotificationRateLimitError(`WhatsApp rate limit exceeded (HTTP 429)`);
      }
      if (!response.ok) {
        const errorMessage = (body as WhatsAppErrorResponse)?.error?.message ?? `HTTP ${response.status}`;
        throw new NotificationError(`WhatsApp returned an error: ${errorMessage}`);
      }

      if (!isWhatsAppSuccessResponse(body)) {
        throw new InvalidNotificationResponseError("WhatsApp response did not match the expected shape");
      }

      const providerMessageId = body.messages?.[0]?.id;
      return {
        success: true,
        providerMessageId,
        statusDescription: providerMessageId ? "delivered to WhatsApp API" : "accepted, no message id returned"
      };
    }
  };
}
