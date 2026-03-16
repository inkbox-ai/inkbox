/**
 * inkbox-phone/resources/transcripts.ts
 *
 * Transcript retrieval.
 */
import { HttpTransport } from "../../_http.js";
import { PhoneTranscript } from "../types.js";
export declare class TranscriptsResource {
    private readonly http;
    constructor(http: HttpTransport);
    /**
     * List all transcript segments for a call, ordered by sequence number.
     *
     * @param phoneNumberId - UUID of the phone number.
     * @param callId - UUID of the call.
     */
    list(phoneNumberId: string, callId: string): Promise<PhoneTranscript[]>;
}
//# sourceMappingURL=transcripts.d.ts.map