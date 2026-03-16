/**
 * inkbox-phone/resources/calls.ts
 *
 * Call operations: list, get, place.
 */
import { parsePhoneCall, parsePhoneCallWithRateLimit, } from "../types.js";
export class CallsResource {
    http;
    constructor(http) {
        this.http = http;
    }
    /**
     * List calls for a phone number, newest first.
     *
     * @param phoneNumberId - UUID of the phone number.
     * @param options.limit - Max results (1–200). Defaults to 50.
     * @param options.offset - Pagination offset. Defaults to 0.
     */
    async list(phoneNumberId, options) {
        const data = await this.http.get(`/numbers/${phoneNumberId}/calls`, { limit: options?.limit ?? 50, offset: options?.offset ?? 0 });
        return data.map(parsePhoneCall);
    }
    /**
     * Get a single call by ID.
     *
     * @param phoneNumberId - UUID of the phone number.
     * @param callId - UUID of the call.
     */
    async get(phoneNumberId, callId) {
        const data = await this.http.get(`/numbers/${phoneNumberId}/calls/${callId}`);
        return parsePhoneCall(data);
    }
    /**
     * Place an outbound call.
     *
     * @param options.fromNumber - E.164 number to call from. Must belong to your org and be active.
     * @param options.toNumber - E.164 number to call.
     * @param options.clientWebsocketUrl - WebSocket URL (wss://) for audio bridging.
     * @param options.webhookUrl - Custom webhook URL for call lifecycle events.
     * @returns The created call record with current rate limit info.
     */
    async place(options) {
        const body = {
            from_number: options.fromNumber,
            to_number: options.toNumber,
        };
        if (options.clientWebsocketUrl !== undefined) {
            body["client_websocket_url"] = options.clientWebsocketUrl;
        }
        if (options.webhookUrl !== undefined) {
            body["webhook_url"] = options.webhookUrl;
        }
        const data = await this.http.post("/place-call", body);
        return parsePhoneCallWithRateLimit(data);
    }
}
//# sourceMappingURL=calls.js.map