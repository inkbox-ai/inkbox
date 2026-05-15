/**
 * inkbox-identities TypeScript SDK — public types.
 */

import type {
  FilterMode,
  FilterModeChangeNotice,
  RawFilterModeChangeNotice,
} from "../mail/types.js";
import {
  FilterMode as FilterModeEnum,
  parseFilterModeChangeNotice,
} from "../mail/types.js";
import { SmsStatus } from "../phone/types.js";
import type { RawTunnel, TLSMode, Tunnel } from "../tunnels/types.js";
import { parseTunnel } from "../tunnels/types.js";

export interface IdentityMailboxCreateOptions {
  emailLocalPart?: string;
  /**
   * Optional sending-domain selector by **bare domain name** (not an id).
   * Omit to inherit the org's default. Pass `null` to force the platform
   * default. Pass a verified custom-domain name (e.g. `"mail.acme.com"`)
   * to bind this mailbox to it.
   */
  sendingDomain?: string | null;
}

export interface IdentityPhoneNumberCreateOptions {
  type?: string;
  state?: string;
  incomingCallAction?: string;
  clientWebsocketUrl?: string;
  incomingCallWebhookUrl?: string;
  incomingTextWebhookUrl?: string;
}

export interface IdentityTunnelCreateOptions {
  tlsMode?: TLSMode | "edge" | "passthrough";
}

export interface CreateIdentityOptions {
  /** Identity-level human-readable name. Defaults server-side to `agentHandle`. */
  displayName?: string;
  /**
   * Free-form org-internal description. Pass a string to set, `null` to
   * leave the column null. Never surfaces in outbound mail / public payloads.
   */
  description?: string | null;
  emailLocalPart?: string;
  /**
   * Optional sending-domain selector by **bare domain name**. Presence
   * (including explicit `null`) configures the mailbox's sending domain.
   * Omit to inherit the org's default, `null` to force the platform default,
   * or a verified domain name to bind to that domain.
   */
  sendingDomain?: string | null;
  /** Optional nested tunnel spec. Server defaults to edge TLS if omitted. */
  tunnel?: IdentityTunnelCreateOptions;
  phoneNumber?: IdentityPhoneNumberCreateOptions;
  vaultSecretIds?: string | string[] | "*" | "all";
}

export interface IdentityMailbox {
  id: string;
  emailAddress: string;
  /**
   * Bare domain the mailbox sends from, derived from `emailAddress`.
   * Either the platform default or a verified custom domain.
   */
  sendingDomain: string;
  /** HTTPS webhook URL for mail events, or `null` if not configured. */
  webhookUrl: string | null;
  filterMode: FilterMode;
  /**
   * UUID of the owning agent identity. Non-null for live customer
   * mailboxes (1:1 invariant); null only on deleted rows and system mailboxes.
   */
  agentIdentityId: string | null;
  createdAt: Date;
  updatedAt: Date;
  filterModeChangeNotice: FilterModeChangeNotice | null;
}

export interface IdentityPhoneNumber {
  id: string;
  number: string;
  /** "toll_free" | "local" */
  type: string;
  /** "active" | "paused" | "released" */
  status: string;
  /** Outbound SMS readiness — gate `sendText` on `ready`. */
  smsStatus: SmsStatus;
  smsErrorCode: string | null;
  smsErrorDetail: string | null;
  smsReadyAt: Date | null;
  /** "auto_accept" | "auto_reject" | "webhook" */
  incomingCallAction: string;
  clientWebsocketUrl: string | null;
  incomingCallWebhookUrl: string | null;
  incomingTextWebhookUrl: string | null;
  filterMode: FilterMode;
  /**
   * 2-letter US state abbreviation for LOCAL numbers (e.g. `"NY"`);
   * `null` for TOLL_FREE.
   */
  state: string | null;
  /**
   * UUID of the owning agent identity, or `null` if standalone. On the
   * embedded variant this always equals the owning identity's ID.
   */
  agentIdentityId: string | null;
  createdAt: Date;
  updatedAt: Date;
  filterModeChangeNotice: FilterModeChangeNotice | null;
}

/** Lightweight identity returned by list endpoints. */
export interface AgentIdentitySummary {
  id: string;
  organizationId: string;
  agentHandle: string;
  displayName: string | null;
  description: string | null;
  /** Email address assigned at creation time. Always trust this value — do not derive it from `agentHandle`. */
  emailAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** @internal Full identity data with channels — users interact with AgentIdentity (the class) instead. */
export interface _AgentIdentityData extends AgentIdentitySummary {
  /** Mailbox assigned to this identity. Non-null for live identities (1:1 invariant); null only on deleted rows. */
  mailbox: IdentityMailbox | null;
  /** Phone number assigned to this identity, or null if unlinked. */
  phoneNumber: IdentityPhoneNumber | null;
  /** Tunnel assigned to this identity. Non-null for live identities (1:1 invariant); null only on deleted rows. */
  tunnel: Tunnel | null;
}

// ---- internal raw API shapes (snake_case from JSON) ----

export interface RawIdentityMailbox {
  id: string;
  email_address: string;
  sending_domain?: string;
  webhook_url?: string | null;
  filter_mode?: string;
  agent_identity_id?: string | null;
  filter_mode_change_notice?: RawFilterModeChangeNotice | null;
  created_at: string;
  updated_at: string;
}

export interface RawIdentityPhoneNumber {
  id: string;
  number: string;
  type: string;
  status: string;
  sms_status?: string;
  sms_error_code?: string | null;
  sms_error_detail?: string | null;
  sms_ready_at?: string | null;
  incoming_call_action: string;
  client_websocket_url: string | null;
  incoming_call_webhook_url?: string | null;
  incoming_text_webhook_url: string | null;
  filter_mode?: string;
  state?: string | null;
  agent_identity_id?: string | null;
  filter_mode_change_notice?: RawFilterModeChangeNotice | null;
  created_at: string;
  updated_at: string;
}

export interface RawAgentIdentitySummary {
  id: string;
  organization_id: string;
  agent_handle: string;
  display_name: string | null;
  description: string | null;
  email_address: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawAgentIdentityData extends RawAgentIdentitySummary {
  mailbox: RawIdentityMailbox | null;
  phone_number: RawIdentityPhoneNumber | null;
  tunnel: RawTunnel | null;
}

// ---- parsers ----

export function parseIdentityMailbox(r: RawIdentityMailbox): IdentityMailbox {
  return {
    id: r.id,
    emailAddress: r.email_address,
    sendingDomain: r.sending_domain ?? r.email_address.split("@")[1] ?? "",
    webhookUrl: r.webhook_url ?? null,
    filterMode: (r.filter_mode as FilterMode) ?? FilterModeEnum.BLACKLIST,
    agentIdentityId: r.agent_identity_id ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    filterModeChangeNotice: r.filter_mode_change_notice
      ? parseFilterModeChangeNotice(r.filter_mode_change_notice)
      : null,
  };
}

export function parseIdentityPhoneNumber(r: RawIdentityPhoneNumber): IdentityPhoneNumber {
  return {
    id: r.id,
    number: r.number,
    type: r.type,
    status: r.status,
    smsStatus: (r.sms_status as SmsStatus) ?? SmsStatus.READY,
    smsErrorCode: r.sms_error_code ?? null,
    smsErrorDetail: r.sms_error_detail ?? null,
    smsReadyAt: r.sms_ready_at ? new Date(r.sms_ready_at) : null,
    incomingCallAction: r.incoming_call_action,
    clientWebsocketUrl: r.client_websocket_url,
    incomingCallWebhookUrl: r.incoming_call_webhook_url ?? null,
    incomingTextWebhookUrl: r.incoming_text_webhook_url ?? null,
    filterMode: (r.filter_mode as FilterMode) ?? FilterModeEnum.BLACKLIST,
    state: r.state ?? null,
    agentIdentityId: r.agent_identity_id ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    filterModeChangeNotice: r.filter_mode_change_notice
      ? parseFilterModeChangeNotice(r.filter_mode_change_notice)
      : null,
  };
}

export function parseAgentIdentitySummary(r: RawAgentIdentitySummary): AgentIdentitySummary {
  return {
    id: r.id,
    organizationId: r.organization_id,
    agentHandle: r.agent_handle,
    displayName: r.display_name ?? null,
    description: r.description ?? null,
    emailAddress: r.email_address,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseAgentIdentityData(r: RawAgentIdentityData): _AgentIdentityData {
  return {
    ...parseAgentIdentitySummary(r),
    mailbox: r.mailbox ? parseIdentityMailbox(r.mailbox) : null,
    phoneNumber: r.phone_number ? parseIdentityPhoneNumber(r.phone_number) : null,
    tunnel: r.tunnel ? parseTunnel(r.tunnel) : null,
  };
}

export function identityMailboxCreateOptionsToWire(
  options: IdentityMailboxCreateOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (options.emailLocalPart !== undefined) body["email_local_part"] = options.emailLocalPart;
  if ("sendingDomain" in options) body["sending_domain"] = options.sendingDomain;
  return body;
}

export function identityTunnelCreateOptionsToWire(
  options: IdentityTunnelCreateOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (options.tlsMode !== undefined) body["tls_mode"] = options.tlsMode;
  return body;
}

export function identityPhoneNumberCreateOptionsToWire(
  options: IdentityPhoneNumberCreateOptions,
): Record<string, unknown> {
  if (options.type === "toll_free" && options.state !== undefined) {
    throw new Error("state is only supported for local phone numbers");
  }
  if (options.incomingCallAction === "auto_accept" && options.clientWebsocketUrl === undefined) {
    throw new Error("clientWebsocketUrl is required for auto_accept");
  }
  if (options.incomingCallAction === "webhook" && options.incomingCallWebhookUrl === undefined) {
    throw new Error("incomingCallWebhookUrl is required for webhook");
  }

  const body: Record<string, unknown> = {};
  if (options.type !== undefined) body["type"] = options.type;
  if (options.state !== undefined) body["state"] = options.state;
  if (options.incomingCallAction !== undefined) body["incoming_call_action"] = options.incomingCallAction;
  if (options.clientWebsocketUrl !== undefined) body["client_websocket_url"] = options.clientWebsocketUrl;
  if (options.incomingCallWebhookUrl !== undefined) body["incoming_call_webhook_url"] = options.incomingCallWebhookUrl;
  if (options.incomingTextWebhookUrl !== undefined) body["incoming_text_webhook_url"] = options.incomingTextWebhookUrl;
  return body;
}

export function vaultSecretIdsToWire(
  value: string | string[] | "*" | "all" | undefined,
): string | string[] | "*" | "all" | undefined {
  return value;
}
