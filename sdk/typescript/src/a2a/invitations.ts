/** Organization-managed A2A invitations. */

import type { HttpTransport } from "../_http.js";

export type A2AInvitationStatus =
  | "pending"
  | "awaiting_verification"
  | "accepted"
  | "declined"
  | "revoked"
  | "expired";

export type A2AInvitationEmailStatus =
  | "not_requested"
  | "pending"
  | "sent"
  | "failed"
  | "indeterminate";

export interface A2AInvitation {
  id: string;
  issuerOrganizationId: string;
  peerAgentHandles: string[];
  recipientEmail: string | null;
  status: A2AInvitationStatus;
  emailStatus: A2AInvitationEmailStatus;
  emailSentAt: string | null;
  inviteeIdentityId: string | null;
  inviteeAgentHandle: string | null;
  inviteeOrganizationId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface A2AInvitationCreateOptions {
  peerAgentHandles: string[];
  recipientEmail?: string;
  expiresInSeconds?: number;
}

export interface A2AInvitationCreateResult extends A2AInvitation {
  /** Present only when the invitation is not bound to a recipient email. */
  invitationToken?: string;
  /** Present only when the invitation is not bound to a recipient email. */
  agentHandoffPrompt?: string;
}

export interface A2AInvitationListOptions {
  status?: A2AInvitationStatus;
  cursor?: string;
  limit?: number;
}

export interface A2AInvitationPage {
  items: A2AInvitation[];
  nextCursor: string | null;
}

export interface A2AInvitationAcceptResult {
  invitationId: string;
  status: "accepted";
  inviteeIdentityId: string;
  inviteeAgentHandle: string;
  peerAgentHandles: string[];
  acceptedAt: string;
}

type Raw = Record<string, any>;

function parseInvitation(raw: Raw): A2AInvitation {
  return {
    id: raw.id,
    issuerOrganizationId: raw.issuer_organization_id,
    peerAgentHandles: raw.peer_agent_handles,
    recipientEmail: raw.recipient_email ?? null,
    status: raw.status,
    emailStatus: raw.email_status,
    emailSentAt: raw.email_sent_at ?? null,
    inviteeIdentityId: raw.invitee_identity_id ?? null,
    inviteeAgentHandle: raw.invitee_agent_handle ?? null,
    inviteeOrganizationId: raw.invitee_organization_id ?? null,
    expiresAt: raw.expires_at,
    acceptedAt: raw.accepted_at ?? null,
    declinedAt: raw.declined_at ?? null,
    revokedAt: raw.revoked_at ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export class A2AInvitationsResource {
  constructor(private readonly http: HttpTransport) {}

  async create(options: A2AInvitationCreateOptions): Promise<A2AInvitationCreateResult> {
    const raw = await this.http.post<Raw>("/a2a/invitations", {
      peer_agent_handles: options.peerAgentHandles,
      ...(options.recipientEmail !== undefined
        ? { recipient_email: options.recipientEmail }
        : {}),
      ...(options.expiresInSeconds !== undefined
        ? { expires_in_seconds: options.expiresInSeconds }
        : {}),
    });
    return {
      ...parseInvitation(raw),
      ...(raw.invitation_token !== undefined
        ? { invitationToken: raw.invitation_token }
        : {}),
      ...(raw.agent_handoff_prompt !== undefined
        ? { agentHandoffPrompt: raw.agent_handoff_prompt }
        : {}),
    };
  }

  async list(options: A2AInvitationListOptions = {}): Promise<A2AInvitationPage> {
    const raw = await this.http.get<Raw>("/a2a/invitations", {
      status: options.status,
      cursor: options.cursor,
      limit: options.limit ?? 50,
    });
    return {
      items: (raw.items ?? []).map(parseInvitation),
      nextCursor: raw.next_cursor ?? null,
    };
  }

  async get(invitationId: string): Promise<A2AInvitation> {
    return parseInvitation(
      await this.http.get<Raw>(`/a2a/invitations/${encodeURIComponent(invitationId)}`),
    );
  }

  async revoke(invitationId: string): Promise<A2AInvitation> {
    return parseInvitation(
      await this.http.post<Raw>(
        `/a2a/invitations/${encodeURIComponent(invitationId)}/revoke`,
      ),
    );
  }

  async accept(invitationToken: string): Promise<A2AInvitationAcceptResult> {
    const raw = await this.http.post<Raw>("/a2a/invitations/accept", {
      invitation_token: invitationToken,
    });
    return {
      invitationId: raw.invitation_id,
      status: raw.status,
      inviteeIdentityId: raw.invitee_identity_id,
      inviteeAgentHandle: raw.invitee_agent_handle,
      peerAgentHandles: raw.peer_agent_handles,
      acceptedAt: raw.accepted_at,
    };
  }
}
