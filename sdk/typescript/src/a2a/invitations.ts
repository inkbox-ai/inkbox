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
  inviterEmail: string | null;
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
  /** Shareable acceptance link, when returned by the server. */
  invitationUrl?: string;
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

/** Raised when an A2A invitation link is invalid for the configured site. */
export class A2AInvitationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "A2AInvitationParseError";
  }
}

const malformedEscape = /%(?![0-9A-Fa-f]{2})/;
const invitationTokenPattern = /^a2ai_[A-Za-z0-9_-]{43}$/;
const maxInvitationInputBytes = 2048;
const officialInvitationOriginsByApiOrigin = new Map([
  ["https://api.inkbox.ai", "https://inkbox.ai"],
  ["https://api.beta.inkbox.ai", "https://beta.inkbox.ai"],
  ["https://api.development.inkbox.ai", "https://development.inkbox.ai"],
]);

function invitationOriginAllowed(invitationUrl: URL, configuredUrl: URL): boolean {
  return invitationUrl.origin === configuredUrl.origin
    || officialInvitationOriginsByApiOrigin.get(configuredUrl.origin)
      === invitationUrl.origin;
}

/**
 * Return the raw token from an A2A invitation link or raw token.
 * Links require HTTPS, except configured localhost/127.0.0.1 development URLs.
 */
export function extractA2AInvitationToken(
  value: string,
  baseUrl = "https://inkbox.ai",
): string {
  if (!value || new TextEncoder().encode(value).byteLength > maxInvitationInputBytes) {
    throw new A2AInvitationParseError("The A2A invitation link or token is invalid.");
  }
  const candidate = value.trim();
  if (invitationTokenPattern.test(candidate)) return candidate;
  if (
    !candidate.includes("://")
    && !candidate.toLowerCase().startsWith("http:")
    && !candidate.toLowerCase().startsWith("https:")
  ) {
    throw new A2AInvitationParseError("The A2A invitation link or token is invalid.");
  }
  if (!/^https?:\/\//i.test(candidate)) {
    throw new A2AInvitationParseError("The A2A invitation link is invalid.");
  }

  let invitationUrl: URL;
  let configuredUrl: URL;
  try {
    invitationUrl = new URL(candidate);
    configuredUrl = new URL(baseUrl);
  } catch {
    throw new A2AInvitationParseError("The A2A invitation link is invalid.");
  }
  if (
    !["http:", "https:"].includes(invitationUrl.protocol)
    || !["http:", "https:"].includes(configuredUrl.protocol)
    || invitationUrl.username
    || invitationUrl.password
  ) {
    throw new A2AInvitationParseError("The A2A invitation link is invalid.");
  }
  if (
    configuredUrl.protocol === "http:"
    && configuredUrl.hostname !== "localhost"
    && configuredUrl.hostname !== "127.0.0.1"
  ) {
    throw new A2AInvitationParseError("The configured site URL is invalid.");
  }
  if (!invitationOriginAllowed(invitationUrl, configuredUrl)) {
    throw new A2AInvitationParseError(
      "The A2A invitation link does not match the configured site.",
    );
  }
  const fragmentStart = candidate.indexOf("#");
  const beforeFragment = candidate.slice(
    0,
    fragmentStart < 0 ? undefined : fragmentStart,
  );
  if (
    invitationUrl.pathname !== "/console/a2a/invitations/accept"
    || beforeFragment.includes("?")
  ) {
    throw new A2AInvitationParseError("The A2A invitation link is invalid.");
  }
  const fragment = invitationUrl.hash.slice(1);
  if (malformedEscape.test(fragment)) {
    throw new A2AInvitationParseError("The A2A invitation link is invalid.");
  }
  const fields = [...new URLSearchParams(fragment).entries()];
  if (
    fields.length !== 1
    || fields[0]?.[0] !== "token"
    || !invitationTokenPattern.test(fields[0]?.[1] ?? "")
  ) {
    throw new A2AInvitationParseError("The A2A invitation link is invalid.");
  }
  return fields[0][1];
}

function parseInvitation(raw: Raw): A2AInvitation {
  return {
    id: raw.id,
    issuerOrganizationId: raw.issuer_organization_id,
    inviterEmail: raw.inviter_email ?? null,
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
  constructor(
    private readonly http: HttpTransport,
    private readonly baseUrl = "https://inkbox.ai",
  ) {}

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
      ...(typeof raw.invitation_url === "string"
        ? { invitationUrl: raw.invitation_url }
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

  async accept(invitation: string): Promise<A2AInvitationAcceptResult> {
    const invitationToken = extractA2AInvitationToken(invitation, this.baseUrl);
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
