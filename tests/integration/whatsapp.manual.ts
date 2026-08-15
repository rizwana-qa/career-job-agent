/**
 * Manual live test for the WhatsApp notification channel (Phase 7).
 *
 * This is NOT run by `npm test`. If WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
 * or WHATSAPP_RECIPIENT_NUMBER are missing, it exits gracefully WITHOUT
 * attempting any network call. If all three are present, it sends exactly
 * ONE controlled test message — never a real job notification, never the
 * full resume, never credentials.
 *
 * Usage:
 *   npm run test:whatsapp
 */
import { createWhatsAppProvider } from "../../src/notifications/whatsappProvider.js";
import { env } from "../../src/config/env.js";
import { toSafeErrorMessage } from "../../src/utils/errors.js";

async function main() {
  if (!env.whatsappApiToken || !env.whatsappPhoneNumberId || !env.whatsappRecipientNumber) {
    console.error(
      "WhatsApp is not configured (WHATSAPP_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_RECIPIENT_NUMBER).\n" +
        "See .env.example. Skipping the live WhatsApp test — no network call was made."
    );
    process.exitCode = 1;
    return;
  }

  const provider = createWhatsAppProvider();
  console.log("Sending one controlled test notification via the real WhatsApp Cloud API...");

  try {
    const result = await provider.sendNotification({
      text: "CAREER AGENT\n\nThis is a controlled test notification from career-job-agent. No job data is included."
    });
    console.log(`Delivery: ${result.success ? "SUCCESS" : "FAILURE"}`);
    console.log(`Provider status: ${result.statusDescription}`);
    if (result.providerMessageId) {
      console.log(`Provider message id: ${result.providerMessageId}`);
    }
  } catch (error) {
    console.log("Delivery: FAILURE");
    console.log(`Provider status: ${toSafeErrorMessage(error)}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Live WhatsApp test failed unexpectedly:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
