/**
 * inkbox/agent_signup/types.ts
 *
 * Types for the agent self-signup flow.
 */

// ---- public interfaces (camelCase) ----

export interface AgentSignupRequest {
  humanEmail: string;
  noteToHuman: string;
  displayName?: string;
  agentHandle?: string;
  emailLocalPart?: string;
  harness?: string;
  invitationToken?: string;
}

export interface AgentSignupInvitationSummary {
  invitationId: string;
  status: "awaiting_verification" | "accepted";
  inviteeIdentityId: string;
  inviteeAgentHandle: string;
  peerAgentHandles: string[];
  acceptedAt: string | null;
}

export interface AgentSignupResponse {
  emailAddress: string;
  organizationId: string;
  apiKey: string;
  agentHandle: string;
  claimStatus: string;
  humanEmail: string;
  message: string;
  invitation?: AgentSignupInvitationSummary;
}

export interface AgentSignupVerifyRequest {
  verificationCode: string;
}

export interface AgentSignupVerifyResponse {
  claimStatus: string;
  organizationId: string;
  message: string;
  invitation?: AgentSignupInvitationSummary;
}

export interface AgentSignupResendResponse {
  claimStatus: string;
  organizationId: string;
  message: string;
}

export interface SignupRestrictions {
  maxSendsPerDay: number;
  allowedRecipients: string[];
  canReceive: boolean;
  canCreateMailboxes: boolean;
}

export interface AgentSignupStatusResponse {
  claimStatus: string;
  humanState: string;
  humanEmail: string;
  restrictions: SignupRestrictions;
}

// ---- internal raw API shapes (snake_case from JSON) ----

export interface RawAgentSignupResponse {
  email_address: string;
  organization_id: string;
  api_key: string;
  agent_handle: string;
  claim_status: string;
  human_email: string;
  message: string;
  invitation?: RawAgentSignupInvitationSummary | null;
}

export interface RawAgentSignupInvitationSummary {
  invitation_id: string;
  status: "awaiting_verification" | "accepted";
  invitee_identity_id: string;
  invitee_agent_handle: string;
  peer_agent_handles: string[];
  accepted_at: string | null;
}

export interface RawAgentSignupVerifyResponse {
  claim_status: string;
  organization_id: string;
  message: string;
  invitation?: RawAgentSignupInvitationSummary | null;
}

export interface RawAgentSignupResendResponse {
  claim_status: string;
  organization_id: string;
  message: string;
}

export interface RawSignupRestrictions {
  max_sends_per_day: number;
  allowed_recipients: string[];
  can_receive: boolean;
  can_create_mailboxes: boolean;
}

export interface RawAgentSignupStatusResponse {
  claim_status: string;
  human_state: string;
  human_email: string;
  restrictions: RawSignupRestrictions;
}

// ---- parsers ----

export function parseAgentSignupResponse(r: RawAgentSignupResponse): AgentSignupResponse {
  return {
    emailAddress: r.email_address,
    organizationId: r.organization_id,
    apiKey: r.api_key,
    agentHandle: r.agent_handle,
    claimStatus: r.claim_status,
    humanEmail: r.human_email,
    message: r.message,
    ...(r.invitation ? { invitation: parseInvitationSummary(r.invitation) } : {}),
  };
}

export function parseAgentSignupVerifyResponse(r: RawAgentSignupVerifyResponse): AgentSignupVerifyResponse {
  return {
    claimStatus: r.claim_status,
    organizationId: r.organization_id,
    message: r.message,
    ...(r.invitation ? { invitation: parseInvitationSummary(r.invitation) } : {}),
  };
}

function parseInvitationSummary(r: RawAgentSignupInvitationSummary): AgentSignupInvitationSummary {
  return {
    invitationId: r.invitation_id,
    status: r.status,
    inviteeIdentityId: r.invitee_identity_id,
    inviteeAgentHandle: r.invitee_agent_handle,
    peerAgentHandles: r.peer_agent_handles,
    acceptedAt: r.accepted_at,
  };
}

export function parseAgentSignupResendResponse(r: RawAgentSignupResendResponse): AgentSignupResendResponse {
  return {
    claimStatus: r.claim_status,
    organizationId: r.organization_id,
    message: r.message,
  };
}

function parseSignupRestrictions(r: RawSignupRestrictions): SignupRestrictions {
  return {
    maxSendsPerDay: r.max_sends_per_day,
    allowedRecipients: r.allowed_recipients,
    canReceive: r.can_receive,
    canCreateMailboxes: r.can_create_mailboxes,
  };
}

export function parseAgentSignupStatusResponse(r: RawAgentSignupStatusResponse): AgentSignupStatusResponse {
  return {
    claimStatus: r.claim_status,
    humanState: r.human_state,
    humanEmail: r.human_email,
    restrictions: parseSignupRestrictions(r.restrictions),
  };
}

// ---- to-wire ----

export function agentSignupRequestToWire(
  req: AgentSignupRequest,
): Record<string, string> {
  const body: Record<string, string> = {
    human_email: req.humanEmail,
    note_to_human: req.noteToHuman,
  };
  if (req.displayName !== undefined) body["display_name"] = req.displayName;
  if (req.agentHandle !== undefined) body["agent_handle"] = req.agentHandle;
  if (req.emailLocalPart !== undefined) body["email_local_part"] = req.emailLocalPart;
  if (req.harness !== undefined) body["harness"] = req.harness;
  if (req.invitationToken !== undefined) body["invitation_token"] = req.invitationToken;
  return body;
}

export function agentSignupVerifyRequestToWire(
  req: AgentSignupVerifyRequest,
): Record<string, string> {
  return { verification_code: req.verificationCode };
}
