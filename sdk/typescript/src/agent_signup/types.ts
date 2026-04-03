/**
 * inkbox/agent_signup/types.ts
 *
 * Types for the agent self-signup flow.
 */

// ---- public interfaces (camelCase) ----

export interface AgentSignupRequest {
  humanEmail: string;
  displayName: string;
  noteToHuman?: string;
}

export interface AgentSignupResponse {
  emailAddress: string;
  organizationId: string;
  apiKey: string;
  agentHandle: string;
  claimStatus: string;
  humanEmail: string;
  message: string;
}

export interface AgentSignupVerifyRequest {
  verificationCode: string;
}

export interface AgentSignupVerifyResponse {
  claimStatus: string;
  organizationId: string;
  message: string;
}

export interface AgentSignupResendResponse {
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
}

export interface RawAgentSignupVerifyResponse {
  claim_status: string;
  organization_id: string;
  message: string;
}

export interface RawAgentSignupResendResponse {
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
  };
}

export function parseAgentSignupVerifyResponse(r: RawAgentSignupVerifyResponse): AgentSignupVerifyResponse {
  return {
    claimStatus: r.claim_status,
    organizationId: r.organization_id,
    message: r.message,
  };
}

export function parseAgentSignupResendResponse(r: RawAgentSignupResendResponse): AgentSignupResendResponse {
  return { message: r.message };
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
    display_name: req.displayName,
  };
  if (req.noteToHuman !== undefined) body["note_to_human"] = req.noteToHuman;
  return body;
}

export function agentSignupVerifyRequestToWire(
  req: AgentSignupVerifyRequest,
): Record<string, string> {
  return { verification_code: req.verificationCode };
}
