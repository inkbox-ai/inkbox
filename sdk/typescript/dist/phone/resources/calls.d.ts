/**
 * inkbox-phone/resources/calls.ts
 *
 * Call operations: list, get, place.
 */
import { HttpTransport } from "../../_http.js";
import { PhoneCall, PhoneCallWithRateLimit } from "../types.js";
export declare class CallsResource {
    private readonly http;
    constructor(http: HttpTransport);
    /**
     * List calls for a phone number, newest first.
     *
     * @param phoneNumberId - UUID of the phone number.
     * @param options.limit - Max results (1–200). Defaults to 50.
     * @param options.offset - Pagination offset. Defaults to 0.
     */
    list(phoneNumberId: string, options?: {
        limit?: number;
        offset?: number;
    }): Promise<PhoneCall[]>;
    /**
     * Get a single call by ID.
     *
     * @param phoneNumberId - UUID of the phone number.
     * @param callId - UUID of the call.
     */
    get(phoneNumberId: string, callId: string): Promise<PhoneCall>;
    /**
     * Place an outbound call.
     *
     * @param options.fromNumber - E.164 number to call from. Must belong to your org and be active.
     * @param options.toNumber - E.164 number to call.
     * @param options.clientWebsocketUrl - WebSocket URL (wss://) for audio bridging.
     * @param options.webhookUrl - Custom webhook URL for call lifecycle events.
     * @returns The created call record with current rate limit info.
     */
    place(options: {
        fromNumber: string;
        toNumber: string;
        clientWebsocketUrl?: string;
        webhookUrl?: string;
    }): Promise<PhoneCallWithRateLimit>;
}
//# sourceMappingURL=calls.d.ts.map