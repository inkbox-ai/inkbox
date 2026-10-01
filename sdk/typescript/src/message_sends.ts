/** Retry-safe message requests and read-only recovery of original identifiers. */
import { randomUUID } from "node:crypto";
import { HttpTransport, InkboxAPIError, InkboxConnectionError, validateIdempotencyKey } from "./_http.js";
import type { MailboxesResource } from "./mail/resources/mailboxes.js";

export function messageKey(value?: string): string {
  const key = value ?? randomUUID();
  validateIdempotencyKey(key);
  if (!key.trim() || /[^\x20-\x7e]/.test(key)) throw new RangeError("Use a printable ASCII idempotency key");
  return key;
}

/** Recover a send key from API, connection, timeout, or decoding errors. */
export function getMessageRequestKey(error: unknown): string | undefined {
  return error instanceof Error && "idempotencyKey" in error && typeof error.idempotencyKey === "string"
    ? error.idempotencyKey : undefined;
}

/** Bounded request retries keep the same key. A separate call is a new message. */
export async function postMessage<T>(http: HttpTransport, path: string, body: unknown,
  key?: string, params?: Record<string, string>): Promise<T> {
  const idempotencyKey = messageKey(key);
  const payload = JSON.parse(JSON.stringify(body));
  for (let attempt = 0; ; attempt++) {
    try {
      return await http.post<T>(path, payload, { headers: { "Idempotency-Key": idempotencyKey, "Prefer": "idempotency-replay" }, ...(params ? { params } : {}) });
    } catch (error) {
      if (error instanceof Error) Object.assign(error, { idempotencyKey });
      const code = error instanceof InkboxAPIError && typeof error.detail === "object" ? error.detail.error : null;
      const retryable = error instanceof InkboxConnectionError || error instanceof SyntaxError
        || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) || (error instanceof InkboxAPIError &&
        ([429, 502, 503, 504].includes(error.statusCode) || code === "idempotency_in_progress"));
      const retryAfter = error instanceof InkboxAPIError ? error.retryAfterSeconds ?? 0 : 0;
      if (!retryable || retryAfter > 5 || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.max(retryAfter * 1000, 250 * 2 ** attempt)));
    }
  }
}

export interface MessageSendLookupOptions {
  senderKind: "mailbox" | "phone_number" | "imessage_identity";
  senderId: string;
  operation: string;
  idempotencyKey: string;
}

export class MessageSendsResource {
  constructor(private readonly http: HttpTransport, private readonly mailboxes: MailboxesResource) {}

  /** Recover an ID without sending or retrying delivery. */
  async lookup(options: MessageSendLookupOptions): Promise<string> {
    const result = await this.http.get<{ message_id: string }>("/message-sends/lookup", {
      sender_kind: options.senderKind, sender_id: options.senderId, operation: options.operation,
    }, { headers: { "Idempotency-Key": messageKey(options.idempotencyKey) } });
    return result.message_id;
  }

  async lookupEmail(emailAddress: string, options: { operation?: string; idempotencyKey: string }): Promise<string> {
    const mailbox = await this.mailboxes.get(emailAddress);
    return this.lookup({ senderKind: "mailbox", senderId: mailbox.id,
      operation: options.operation ?? "mail.send", idempotencyKey: options.idempotencyKey });
  }
}
