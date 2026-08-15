import { describe, expect, it, vi } from "vitest";
import { createWhatsAppProvider } from "../../src/notifications/whatsappProvider.js";
import {
  InvalidNotificationResponseError,
  InvalidRecipientError,
  NotificationAuthError,
  NotificationError,
  NotificationNotConfiguredError,
  NotificationRateLimitError,
  NotificationUnavailableError
} from "../../src/utils/errors.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response;
}

const VALID_OPTIONS = {
  apiToken: "test-token",
  phoneNumberId: "123456",
  recipientNumber: "+923001234567"
};

describe("createWhatsAppProvider — configuration / missing credentials", () => {
  it("throws NotificationNotConfiguredError when the API token is missing, without a network call", async () => {
    const fetchImpl = vi.fn();
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, apiToken: undefined, fetchImpl });

    await expect(provider.sendNotification({ text: "hi" })).rejects.toBeInstanceOf(NotificationNotConfiguredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws NotificationNotConfiguredError when the phone number id is missing", async () => {
    const fetchImpl = vi.fn();
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, phoneNumberId: undefined, fetchImpl });

    await expect(provider.sendNotification({ text: "hi" })).rejects.toBeInstanceOf(NotificationNotConfiguredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws NotificationNotConfiguredError when the recipient number is missing", async () => {
    const fetchImpl = vi.fn();
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, recipientNumber: undefined, fetchImpl });

    await expect(provider.sendNotification({ text: "hi" })).rejects.toBeInstanceOf(NotificationNotConfiguredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws InvalidRecipientError for a non-E.164 recipient, without a network call", async () => {
    const fetchImpl = vi.fn();
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, recipientNumber: "03001234567", fetchImpl });

    await expect(provider.sendNotification({ text: "hi" })).rejects.toBeInstanceOf(InvalidRecipientError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("exposes the provider name", () => {
    const provider = createWhatsAppProvider(VALID_OPTIONS);
    expect(provider.name).toBe("whatsapp-cloud-api");
  });
});

describe("createWhatsAppProvider — successful delivery", () => {
  it("sends a text message and returns success with the provider message id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ messages: [{ id: "wamid.ABC123" }] }));
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, fetchImpl });

    const result = await provider.sendNotification({ text: "CAREER AGENT test" });

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe("wamid.ABC123");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends the message text and recipient in the request body, never the token, in a readable way", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ messages: [{ id: "wamid.1" }] }));
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, fetchImpl });

    await provider.sendNotification({ text: "hello world" });

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.to).toBe("+923001234567");
    expect(body.text.body).toBe("hello world");
    expect(body.type).toBe("text");
  });

  it("sends the auth token only in the Authorization header, not the body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ messages: [{ id: "wamid.1" }] }));
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, fetchImpl });

    await provider.sendNotification({ text: "hello" });

    const [, init] = fetchImpl.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(JSON.stringify(body)).not.toContain("test-token");
  });
});

describe("createWhatsAppProvider — error handling", () => {
  it("throws NotificationAuthError on HTTP 401/403", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "Invalid OAuth token" } }, 401));
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, fetchImpl });

    await expect(provider.sendNotification({ text: "hi" })).rejects.toBeInstanceOf(NotificationAuthError);
  });

  it("throws NotificationRateLimitError on HTTP 429", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429));
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, fetchImpl });

    await expect(provider.sendNotification({ text: "hi" })).rejects.toBeInstanceOf(NotificationRateLimitError);
  });

  it("throws NotificationUnavailableError on a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, fetchImpl });

    await expect(provider.sendNotification({ text: "hi" })).rejects.toBeInstanceOf(NotificationUnavailableError);
  });

  it("throws NotificationUnavailableError on a request timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, fetchImpl });

    await expect(provider.sendNotification({ text: "hi" })).rejects.toBeInstanceOf(NotificationUnavailableError);
  });

  it("throws a generic NotificationError on an unexpected non-OK status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "Something else went wrong" } }, 500));
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, fetchImpl });

    await expect(provider.sendNotification({ text: "hi" })).rejects.toBeInstanceOf(NotificationError);
  });

  it("throws InvalidNotificationResponseError when the response body is not valid JSON", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      }
    })) as unknown as typeof fetch;
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, fetchImpl });

    await expect(provider.sendNotification({ text: "hi" })).rejects.toBeInstanceOf(InvalidNotificationResponseError);
  });

  it("never includes the API token in a thrown error's message", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "Invalid OAuth token" } }, 401));
    const provider = createWhatsAppProvider({ ...VALID_OPTIONS, apiToken: "super-secret-token-value", fetchImpl });

    try {
      await provider.sendNotification({ text: "hi" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-token-value");
    }
  });
});
