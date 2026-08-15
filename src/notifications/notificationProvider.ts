/**
 * A pre-formatted, ready-to-send notification. The provider never decides
 * what to say — src/notifications/whatsappMessageBuilder.ts (or an
 * equivalent for a future channel) builds this deterministically, so the
 * provider's only job is delivery.
 */
export interface NotificationMessage {
  text: string;
}

export interface NotificationResult {
  success: boolean;
  /** The provider's own message identifier, if it returns one — safe to log, never a credential. */
  providerMessageId?: string;
  /** Human-readable, safe-to-log delivery status — never contains credentials or full message content. */
  statusDescription: string;
}

/**
 * The channel abstraction Phase 7 is built against. Nothing in
 * src/notifications/notificationService.ts is coupled to WhatsApp
 * specifically — it only knows this interface, the same pattern used for
 * `JobSource` in Phase 6 (src/jobSources/jobSource.ts). Adding a second
 * channel (e.g. Telegram, email) later means implementing this interface
 * again, not touching the notification service or the application workflow.
 */
export interface NotificationProvider {
  /** Machine-readable identifier, used in error/log messages — e.g. "whatsapp-cloud-api". */
  readonly name: string;

  sendNotification(message: NotificationMessage): Promise<NotificationResult>;
}
