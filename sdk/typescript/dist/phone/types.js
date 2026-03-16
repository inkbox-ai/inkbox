/**
 * inkbox-phone TypeScript SDK — public types.
 */
// ---- parsers ----
export function parsePhoneNumber(r) {
    return {
        id: r.id,
        number: r.number,
        type: r.type,
        status: r.status,
        incomingCallAction: r.incoming_call_action,
        clientWebsocketUrl: r.client_websocket_url,
        incomingCallWebhookUrl: r.incoming_call_webhook_url,
        createdAt: new Date(r.created_at),
        updatedAt: new Date(r.updated_at),
    };
}
export function parsePhoneCall(r) {
    return {
        id: r.id,
        localPhoneNumber: r.local_phone_number,
        remotePhoneNumber: r.remote_phone_number,
        direction: r.direction,
        status: r.status,
        clientWebsocketUrl: r.client_websocket_url,
        useInkboxTts: r.use_inkbox_tts,
        useInkboxStt: r.use_inkbox_stt,
        hangupReason: r.hangup_reason,
        startedAt: r.started_at ? new Date(r.started_at) : null,
        endedAt: r.ended_at ? new Date(r.ended_at) : null,
        createdAt: new Date(r.created_at),
        updatedAt: new Date(r.updated_at),
    };
}
export function parseRateLimitInfo(r) {
    return {
        callsUsed: r.calls_used,
        callsRemaining: r.calls_remaining,
        callsLimit: r.calls_limit,
        minutesUsed: r.minutes_used,
        minutesRemaining: r.minutes_remaining,
        minutesLimit: r.minutes_limit,
    };
}
export function parsePhoneCallWithRateLimit(r) {
    return {
        ...parsePhoneCall(r),
        rateLimit: parseRateLimitInfo(r.rate_limit),
    };
}
export function parsePhoneTranscript(r) {
    return {
        id: r.id,
        callId: r.call_id,
        seq: r.seq,
        tsMs: r.ts_ms,
        party: r.party,
        text: r.text,
        createdAt: new Date(r.created_at),
    };
}
//# sourceMappingURL=types.js.map