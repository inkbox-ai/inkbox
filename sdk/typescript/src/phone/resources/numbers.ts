/**
 * inkbox-phone/resources/numbers.ts
 *
 * Phone number CRUD, provisioning, release, and transcript search.
 */

import { HttpTransport } from "../../_http.js";
import {
  PhoneNumber,
  PhoneTranscript,
  RawPhoneNumber,
  RawPhoneTranscript,
  parsePhoneNumber,
  parsePhoneTranscript,
} from "../types.js";

const BASE = "/numbers";

export class PhoneNumbersResource {
  constructor(private readonly http: HttpTransport) {}

  /** List all phone numbers for your organisation. */
  async list(): Promise<PhoneNumber[]> {
    const data = await this.http.get<RawPhoneNumber[]>(BASE);
    return data.map(parsePhoneNumber);
  }

  /** Get a phone number by ID. */
  async get(phoneNumberId: string): Promise<PhoneNumber> {
    const data = await this.http.get<RawPhoneNumber>(
      `${BASE}/${phoneNumberId}`,
    );
    return parsePhoneNumber(data);
  }

  /**
   * Update phone number settings. Only provided fields are updated.
   * Pass a field as `null` to clear it.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param options.incomingCallAction - `"auto_accept"`, `"auto_reject"`, or `"webhook"`.
   * @param options.clientWebsocketUrl - WebSocket URL (wss://) for audio bridging.
   * @param options.incomingCallWebhookUrl - Webhook URL called for incoming calls when action is `"webhook"`.
   */
  async update(
    phoneNumberId: string,
    options: {
      incomingCallAction?: string;
      clientWebsocketUrl?: string | null;
      incomingCallWebhookUrl?: string | null;
      incomingTextWebhookUrl?: string | null;
    },
  ): Promise<PhoneNumber> {
    const body: Record<string, unknown> = {};
    if (options.incomingCallAction !== undefined) {
      body["incoming_call_action"] = options.incomingCallAction;
    }
    if ("clientWebsocketUrl" in options) {
      body["client_websocket_url"] = options.clientWebsocketUrl;
    }
    if ("incomingCallWebhookUrl" in options) {
      body["incoming_call_webhook_url"] = options.incomingCallWebhookUrl;
    }
    if ("incomingTextWebhookUrl" in options) {
      body["incoming_text_webhook_url"] = options.incomingTextWebhookUrl;
    }
    const data = await this.http.patch<RawPhoneNumber>(
      `${BASE}/${phoneNumberId}`,
      body,
    );
    return parsePhoneNumber(data);
  }

  /**
   * Provision a new phone number and link it to an agent identity.
   *
   * @param options.agentHandle - Handle of the agent identity to assign this number to.
   * @param options.type - `"toll_free"` or `"local"`. Defaults to `"toll_free"`.
   * @param options.state - US state abbreviation (e.g. `"NY"`). Only valid for `local` numbers.
   */
  async provision(options: {
    agentHandle: string;
    type?: string;
    state?: string;
  }): Promise<PhoneNumber> {
    const body: Record<string, unknown> = {
      agent_handle: options.agentHandle,
      type: options.type ?? "toll_free",
    };
    if (options.state !== undefined) {
      body["state"] = options.state;
    }
    const data = await this.http.post<RawPhoneNumber>(BASE, body);
    return parsePhoneNumber(data);
  }

  /**
   * Release a phone number.
   *
   * @param phoneNumberId - UUID of the phone number to release.
   */
  async release(phoneNumberId: string): Promise<void> {
    await this.http.delete(`${BASE}/${phoneNumberId}`);
  }

  /**
   * Full-text search across transcripts for a phone number.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param options.q - Search query string.
   * @param options.party - Filter by speaker: `"local"` or `"remote"`.
   * @param options.limit - Maximum number of results (1–200). Defaults to 50.
   */
  async searchTranscripts(
    phoneNumberId: string,
    options: { q: string; party?: string; limit?: number },
  ): Promise<PhoneTranscript[]> {
    const data = await this.http.get<RawPhoneTranscript[]>(
      `${BASE}/${phoneNumberId}/search`,
      { q: options.q, party: options.party, limit: options.limit ?? 50 },
    );
    return data.map(parsePhoneTranscript);
  }
}
