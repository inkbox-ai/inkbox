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

export interface IdentityAuthenticatorApp {
  id: string;
  organizationId: string;
  identityId: string | null;
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
  /** Authenticator app assigned to this identity, or null if unlinked. */
  authenticatorApp: IdentityAuthenticatorApp | null;
}

// ---- internal raw API shapes (snake_case from JSON) ----

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

export interface RawIdentityAuthenticatorApp {
  id: string;
  organization_id: string;
  identity_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RawAgentIdentityData extends RawAgentIdentitySummary {
  mailbox: RawIdentityMailbox | null;
  phone_number: RawIdentityPhoneNumber | null;
  authenticator_app: RawIdentityAuthenticatorApp | null;
}

// ---- parsers ----

export function parseIdentityMailbox(r: RawIdentityMailbox): IdentityMailbox {
  return {
    id: r.id,
    emailAddress: r.email_address,
    displayName: r.display_name,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseIdentityPhoneNumber(r: RawIdentityPhoneNumber): IdentityPhoneNumber {
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

export function parseAgentIdentitySummary(r: RawAgentIdentitySummary): AgentIdentitySummary {
  return {
    id: r.id,
    organizationId: r.organization_id,
    agentHandle: r.agent_handle,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseIdentityAuthenticatorApp(r: RawIdentityAuthenticatorApp): IdentityAuthenticatorApp {
  return {
    id: r.id,
    organizationId: r.organization_id,
    identityId: r.identity_id,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseAgentIdentityData(r: RawAgentIdentityData): _AgentIdentityData {
  return {
    ...parseAgentIdentitySummary(r),
    mailbox: r.mailbox ? parseIdentityMailbox(r.mailbox) : null,
    phoneNumber: r.phone_number ? parseIdentityPhoneNumber(r.phone_number) : null,
    authenticatorApp: r.authenticator_app ? parseIdentityAuthenticatorApp(r.authenticator_app) : null,
  };
}
