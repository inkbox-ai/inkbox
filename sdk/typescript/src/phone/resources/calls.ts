/**
 * inkbox-phone/resources/calls.ts
 *
 * Call operations: list, get, place.
 */

import { HttpTransport } from "../../_http.js";
import {
  PhoneCall,
  PhoneCallWithRateLimit,
  RawPhoneCall,
  RawPhoneCallWithRateLimit,
  parsePhoneCall,
  parsePhoneCallWithRateLimit,
} from "../types.js";

export class CallsResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * List calls for a phone number, newest first.
   *
   * Identity-scoped API keys never see contact-rule-blocked rows
   * regardless of `isBlocked` (filtered server-side). Admin/JWT
   * callers see everything by default; pass `isBlocked=true` for the
   * blocked-only listing or `isBlocked=false` to exclude blocked rows.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isBlocked - Tri-state filter. `true` for only blocked,
   *   `false` for only non-blocked, omit for all.
   */
  async list(
    phoneNumberId: string,
    options?: { limit?: number; offset?: number; isBlocked?: boolean },
  ): Promise<PhoneCall[]> {
    const params: Record<string, string | number | boolean> = {
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    };
    if (options?.isBlocked !== undefined) {
      params["is_blocked"] = options.isBlocked;
    }
    const data = await this.http.get<RawPhoneCall[]>(
      `/numbers/${phoneNumberId}/calls`,
      params,
    );
    return data.map(parsePhoneCall);
  }

  /**
   * Get a single call by ID.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param callId - UUID of the call.
   */
  async get(phoneNumberId: string, callId: string): Promise<PhoneCall> {
    const data = await this.http.get<RawPhoneCall>(
      `/numbers/${phoneNumberId}/calls/${callId}`,
    );
    return parsePhoneCall(data);
  }

  /**
   * Place an outbound call.
   *
   * @param options.fromNumber - E.164 number to call from. Must belong to your org and be active.
   * @param options.toNumber - E.164 number to call.
   * @param options.clientWebsocketUrl - WebSocket URL (wss://) for audio bridging.
   * @returns The created call record with current rate limit info.
   */
  async place(options: {
    fromNumber: string;
    toNumber: string;
    clientWebsocketUrl?: string;
  }): Promise<PhoneCallWithRateLimit> {
    const body: Record<string, unknown> = {
      from_number: options.fromNumber,
      to_number: options.toNumber,
    };
    if (options.clientWebsocketUrl !== undefined) {
      body["client_websocket_url"] = options.clientWebsocketUrl;
    }
    const data = await this.http.post<RawPhoneCallWithRateLimit>("/place-call", body);
    return parsePhoneCallWithRateLimit(data);
  }
}
