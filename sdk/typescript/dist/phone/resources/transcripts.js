/**
 * inkbox-phone/resources/transcripts.ts
 *
 * Transcript retrieval.
 */
import { parsePhoneTranscript, } from "../types.js";
export class TranscriptsResource {
    http;
    constructor(http) {
        this.http = http;
    }
    /**
     * List all transcript segments for a call, ordered by sequence number.
     *
     * @param phoneNumberId - UUID of the phone number.
     * @param callId - UUID of the call.
     */
    async list(phoneNumberId, callId) {
        const data = await this.http.get(`/numbers/${phoneNumberId}/calls/${callId}/transcripts`);
        return data.map(parsePhoneTranscript);
    }
}
//# sourceMappingURL=transcripts.js.map