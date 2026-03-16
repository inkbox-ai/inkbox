/**
 * inkbox-identities TypeScript SDK — public types.
 */
export interface IdentityMailbox {
    id: string;
    emailAddress: string;
    displayName: string | null;
    /** "active" | "paused" | "deleted" */
    status: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface IdentityPhoneNumber {
    id: string;
    number: string;
    /** "toll_free" | "local" */
    type: string;
    /** "active" | "paused" | "released" */
    status: string;
    /** "auto_accept" | "auto_reject" | "webhook" */
    incomingCallAction: string;
    clientWebsocketUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
}
/** Lightweight identity returned by list and update endpoints. */
export interface AgentIdentitySummary {
    id: string;
    organizationId: string;
    agentHandle: string;
    /** "active" | "paused" | "deleted" */
    status: string;
    createdAt: Date;
    updatedAt: Date;
}
/** @internal Full identity data with channels — users interact with AgentIdentity (the class) instead. */
export interface _AgentIdentityData extends AgentIdentitySummary {
    /** Mailbox assigned to this identity, or null if unlinked. */
    mailbox: IdentityMailbox | null;
    /** Phone number assigned to this identity, or null if unlinked. */
    phoneNumber: IdentityPhoneNumber | null;
}
export interface RawIdentityMailbox {
    id: string;
    email_address: string;
    display_name: string | null;
    status: string;
    created_at: string;
    updated_at: string;
}
export interface RawIdentityPhoneNumber {
    id: string;
    number: string;
    type: string;
    status: string;
    incoming_call_action: string;
    client_websocket_url: string | null;
    created_at: string;
    updated_at: string;
}
export interface RawAgentIdentitySummary {
    id: string;
    organization_id: string;
    agent_handle: string;
    status: string;
    created_at: string;
    updated_at: string;
}
export interface RawAgentIdentityData extends RawAgentIdentitySummary {
    mailbox: RawIdentityMailbox | null;
    phone_number: RawIdentityPhoneNumber | null;
}
export declare function parseIdentityMailbox(r: RawIdentityMailbox): IdentityMailbox;
export declare function parseIdentityPhoneNumber(r: RawIdentityPhoneNumber): IdentityPhoneNumber;
export declare function parseAgentIdentitySummary(r: RawAgentIdentitySummary): AgentIdentitySummary;
export declare function parseAgentIdentityData(r: RawAgentIdentityData): _AgentIdentityData;
//# sourceMappingURL=types.d.ts.map