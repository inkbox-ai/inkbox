/**
 * inkbox-phone TypeScript SDK — public types.
 */
export interface PhoneNumber {
    id: string;
    number: string;
    /** "toll_free" | "local" */
    type: string;
    /** "active" | "paused" | "released" */
    status: string;
    /** "auto_accept" | "auto_reject" | "webhook" */
    incomingCallAction: string;
    clientWebsocketUrl: string | null;
    incomingCallWebhookUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface PhoneCall {
    id: string;
    localPhoneNumber: string;
    remotePhoneNumber: string;
    /** "outbound" | "inbound" */
    direction: string;
    /** "initiated" | "ringing" | "answered" | "completed" | "failed" | "canceled" */
    status: string;
    clientWebsocketUrl: string | null;
    useInkboxTts: boolean | null;
    useInkboxStt: boolean | null;
    /** "local" | "remote" | "max_duration" | "voicemail" | "rejected" */
    hangupReason: string | null;
    startedAt: Date | null;
    endedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface RateLimitInfo {
    callsUsed: number;
    callsRemaining: number;
    callsLimit: number;
    minutesUsed: number;
    minutesRemaining: number;
    minutesLimit: number;
}
export interface PhoneCallWithRateLimit extends PhoneCall {
    rateLimit: RateLimitInfo;
}
export interface PhoneTranscript {
    id: string;
    callId: string;
    seq: number;
    tsMs: number;
    /** "local" | "remote" | "system" */
    party: string;
    text: string;
    createdAt: Date;
}
export interface RawPhoneNumber {
    id: string;
    number: string;
    type: string;
    status: string;
    incoming_call_action: string;
    client_websocket_url: string | null;
    incoming_call_webhook_url: string | null;
    created_at: string;
    updated_at: string;
}
export interface RawPhoneCall {
    id: string;
    local_phone_number: string;
    remote_phone_number: string;
    direction: string;
    status: string;
    client_websocket_url: string | null;
    use_inkbox_tts: boolean | null;
    use_inkbox_stt: boolean | null;
    hangup_reason: string | null;
    started_at: string | null;
    ended_at: string | null;
    created_at: string;
    updated_at: string;
}
export interface RawRateLimitInfo {
    calls_used: number;
    calls_remaining: number;
    calls_limit: number;
    minutes_used: number;
    minutes_remaining: number;
    minutes_limit: number;
}
export interface RawPhoneCallWithRateLimit extends RawPhoneCall {
    rate_limit: RawRateLimitInfo;
}
export interface RawPhoneTranscript {
    id: string;
    call_id: string;
    seq: number;
    ts_ms: number;
    party: string;
    text: string;
    created_at: string;
}
export declare function parsePhoneNumber(r: RawPhoneNumber): PhoneNumber;
export declare function parsePhoneCall(r: RawPhoneCall): PhoneCall;
export declare function parseRateLimitInfo(r: RawRateLimitInfo): RateLimitInfo;
export declare function parsePhoneCallWithRateLimit(r: RawPhoneCallWithRateLimit): PhoneCallWithRateLimit;
export declare function parsePhoneTranscript(r: RawPhoneTranscript): PhoneTranscript;
//# sourceMappingURL=types.d.ts.map