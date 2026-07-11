/**
 * inkbox-phone/resources/calls.ts
 *
 * Identity-scoped call operations: list, get, transcripts, place.
 */

import { HttpTransport } from "../../_http.js";
import {
  CallMode,
  CallOrigin,
  PhoneCall,
  PhoneCallWithRateLimit,
  PhoneTranscript,
  RawPhoneCall,
  RawPhoneCallWithRateLimit,
  RawPhoneTranscript,
  parsePhoneCall,
  parsePhoneCallWithRateLimit,
  parsePhoneTranscript,
} from "../types.js";

export class CallsResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * List calls, newest first.
   *
   * Identity-scoped API keys resolve their own identity and never see
   * contact-rule-blocked rows regardless of `isBlocked` (filtered
   * server-side). Admin/JWT callers must pass `agentIdentityId` (the
   * server returns 422 otherwise) and see everything by default; pass
   * `isBlocked=true` for the blocked-only listing or `isBlocked=false`
   * to exclude blocked rows.
   *
   * @param options.agentIdentityId - UUID of the agent identity to scope
   *   to. Optional for agent-scoped keys; required under admin/JWT.
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isBlocked - Tri-state filter. `true` for only blocked,
   *   `false` for only non-blocked, omit for all.
   */
  async list(options?: {
    agentIdentityId?: string;
    limit?: number;
    offset?: number;
    isBlocked?: boolean;
    startDatetime?: string;
    endDatetime?: string;
    tz?: string;
  }): Promise<PhoneCall[]> {
    const params: Record<string, string | number | boolean> = {
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    };
    // Only scope by identity when explicitly supplied.
    if (options?.agentIdentityId !== undefined) {
      params["agent_identity_id"] = options.agentIdentityId;
    }
    if (options?.isBlocked !== undefined) {
      params["is_blocked"] = options.isBlocked;
    }
    if (options?.startDatetime !== undefined) params["start_datetime"] = options.startDatetime;
    if (options?.endDatetime !== undefined) params["end_datetime"] = options.endDatetime;
    if (options?.tz !== undefined) params["tz"] = options.tz;
    const data = await this.http.get<RawPhoneCall[]>("/calls", params);
    return data.map(parsePhoneCall);
  }

  /**
   * Get a single call by ID.
   *
   * @param callId - UUID of the call.
   */
  async get(callId: string): Promise<PhoneCall> {
    const data = await this.http.get<RawPhoneCall>(`/calls/${callId}`);
    return parsePhoneCall(data);
  }

  /**
   * Hang up a live call by ID, from outside the call.
   *
   * The lever for anything not on the call itself (tests, operators,
   * another process); the agent on the call keeps ending it in-band. The
   * carrier confirms the teardown asynchronously, so the returned call can
   * still show its live status for a moment. A call that has already ended
   * (or has no active carrier leg yet) surfaces the server's 409 verbatim.
   *
   * @param callId - UUID of the call.
   */
  async hangup(callId: string): Promise<PhoneCall> {
    const data = await this.http.post<RawPhoneCall>(`/calls/${callId}/hangup`);
    return parsePhoneCall(data);
  }

  /**
   * List all transcript segments for a call, ordered by sequence number.
   *
   * @param callId - UUID of the call.
   */
  async transcripts(callId: string): Promise<PhoneTranscript[]> {
    const data = await this.http.get<RawPhoneTranscript[]>(
      `/calls/${callId}/transcripts`,
    );
    return data.map(parsePhoneTranscript);
  }

  /**
   * Place an outbound call.
   *
   * The server enforces the conditional requirements: `fromNumber` is
   * required for `dedicated_number`, `agentIdentityId` for
   * `shared_imessage_number`; `hosted_agent` mode requires `reason` and
   * excludes `clientWebsocketUrl`. This method never client-gates —
   * violations surface as a server 422.
   *
   * @param options.toNumber - E.164 number to call.
   * @param options.origination - Where the call originates. Defaults to
   *   `dedicated_number`.
   * @param options.fromNumber - E.164 number to call from (dedicated origination).
   * @param options.agentIdentityId - UUID of the placing identity (shared origination).
   * @param options.clientWebsocketUrl - WebSocket URL (wss://) for audio bridging.
   * @param options.mode - Who drives the call. Defaults to `client_websocket`.
   * @param options.reason - The hosted agent's task brief for the call.
   *   Required with `mode=hosted_agent`, invalid otherwise.
   * @returns The created call record with current rate limit info.
   */
  async place(options: {
    toNumber: string;
    origination?: CallOrigin;
    fromNumber?: string;
    agentIdentityId?: string;
    clientWebsocketUrl?: string;
    mode?: CallMode;
    reason?: string;
  }): Promise<PhoneCallWithRateLimit> {
    const body: Record<string, unknown> = {
      to_number: options.toNumber,
      // Always sent (defaults to dedicated_number).
      origination: options.origination ?? CallOrigin.DEDICATED_NUMBER,
      // Always sent (defaults to client_websocket).
      mode: options.mode ?? CallMode.CLIENT_WEBSOCKET,
    };
    if (options.fromNumber !== undefined) {
      body["from_number"] = options.fromNumber;
    }
    if (options.agentIdentityId !== undefined) {
      body["agent_identity_id"] = options.agentIdentityId;
    }
    if (options.clientWebsocketUrl !== undefined) {
      body["client_websocket_url"] = options.clientWebsocketUrl;
    }
    if (options.reason !== undefined) {
      body["reason"] = options.reason;
    }
    const data = await this.http.post<RawPhoneCallWithRateLimit>("/place-call", body);
    return parsePhoneCallWithRateLimit(data);
  }
}
