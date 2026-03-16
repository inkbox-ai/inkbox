/**
 * inkbox-phone/resources/numbers.ts
 *
 * Phone number CRUD, provisioning, release, and transcript search.
 */
import { HttpTransport } from "../../_http.js";
import { PhoneNumber, PhoneTranscript } from "../types.js";
export declare class PhoneNumbersResource {
    private readonly http;
    constructor(http: HttpTransport);
    /** List all phone numbers for your organisation. */
    list(): Promise<PhoneNumber[]>;
    /** Get a phone number by ID. */
    get(phoneNumberId: string): Promise<PhoneNumber>;
    /**
     * Update phone number settings. Only provided fields are updated.
     * Pass a field as `null` to clear it.
     *
     * @param phoneNumberId - UUID of the phone number.
     * @param options.incomingCallAction - `"auto_accept"`, `"auto_reject"`, or `"webhook"`.
     * @param options.clientWebsocketUrl - WebSocket URL (wss://) for audio bridging.
     * @param options.incomingCallWebhookUrl - Webhook URL called for incoming calls when action is `"webhook"`.
     */
    update(phoneNumberId: string, options: {
        incomingCallAction?: string;
        clientWebsocketUrl?: string | null;
        incomingCallWebhookUrl?: string | null;
    }): Promise<PhoneNumber>;
    /**
     * Provision a new phone number and link it to an agent identity.
     *
     * @param options.agentHandle - Handle of the agent identity to assign this number to.
     * @param options.type - `"toll_free"` or `"local"`. Defaults to `"toll_free"`.
     * @param options.state - US state abbreviation (e.g. `"NY"`). Only valid for `local` numbers.
     */
    provision(options: {
        agentHandle: string;
        type?: string;
        state?: string;
    }): Promise<PhoneNumber>;
    /**
     * Release a phone number.
     *
     * @param phoneNumberId - UUID of the phone number to release.
     */
    release(phoneNumberId: string): Promise<void>;
    /**
     * Full-text search across transcripts for a phone number.
     *
     * @param phoneNumberId - UUID of the phone number.
     * @param options.q - Search query string.
     * @param options.party - Filter by speaker: `"local"` or `"remote"`.
     * @param options.limit - Maximum number of results (1–200). Defaults to 50.
     */
    searchTranscripts(phoneNumberId: string, options: {
        q: string;
        party?: string;
        limit?: number;
    }): Promise<PhoneTranscript[]>;
}
//# sourceMappingURL=numbers.d.ts.map