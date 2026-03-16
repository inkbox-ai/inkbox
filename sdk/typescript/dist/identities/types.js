/**
 * inkbox-identities TypeScript SDK — public types.
 */
// ---- parsers ----
export function parseIdentityMailbox(r) {
    return {
        id: r.id,
        emailAddress: r.email_address,
        displayName: r.display_name,
        status: r.status,
        createdAt: new Date(r.created_at),
        updatedAt: new Date(r.updated_at),
    };
}
export function parseIdentityPhoneNumber(r) {
    return {
        id: r.id,
        number: r.number,
        type: r.type,
        status: r.status,
        incomingCallAction: r.incoming_call_action,
        clientWebsocketUrl: r.client_websocket_url,
        createdAt: new Date(r.created_at),
        updatedAt: new Date(r.updated_at),
    };
}
export function parseAgentIdentitySummary(r) {
    return {
        id: r.id,
        organizationId: r.organization_id,
        agentHandle: r.agent_handle,
        status: r.status,
        createdAt: new Date(r.created_at),
        updatedAt: new Date(r.updated_at),
    };
}
export function parseAgentIdentityData(r) {
    return {
        ...parseAgentIdentitySummary(r),
        mailbox: r.mailbox ? parseIdentityMailbox(r.mailbox) : null,
        phoneNumber: r.phone_number ? parseIdentityPhoneNumber(r.phone_number) : null,
    };
}
//# sourceMappingURL=types.js.map