/**
 * inkbox-phone/resources/transcripts.ts
 *
 * Transcript retrieval.
 */

import { HttpTransport } from "../../_http.js";
import {
  PhoneTranscript,
  RawPhoneTranscript,
  parsePhoneTranscript,
} from "../types.js";

export class TranscriptsResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * List all transcript segments for a call, ordered by sequence number.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param callId - UUID of the call.
   */
  async list(
    phoneNumberId: string,
    callId: string,
  ): Promise<PhoneTranscript[]> {
    const data = await this.http.get<RawPhoneTranscript[]>(
      `/numbers/${phoneNumberId}/calls/${callId}/transcripts`,
    );
    return data.map(parsePhoneTranscript);
  }
}
