/**
 * inkbox-identities TypeScript SDK — public types.
 */

import type { AgentWallet, RawAgentWallet } from "../wallet/types.js";
import { parseAgentWallet } from "../wallet/types.js";

export interface IdentityMailboxCreateOptions {
  displayName?: string;
  emailLocalPart?: string;
}

export interface IdentityPhoneNumberCreateOptions {
  type?: string;
  state?: string;
  incomingCallAction?: string;
  clientWebsocketUrl?: string;
  incomingCallWebhookUrl?: string;
  incomingTextWebhookUrl?: string;
}

export interface IdentityWalletCreateOptions {
  chains?: string[];
}

export interface CreateIdentityOptions {
  createMailbox?: boolean;
  displayName?: string;
  emailLocalPart?: string;
  phoneNumber?: IdentityPhoneNumberCreateOptions;
  wallet?: IdentityWalletCreateOptions;
  vaultSecretIds?: string | string[] | "*" | "all";
}

export interface IdentityMailbox {
  id: string;
  emailAddress: string;
  displayName: string | null;
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
  incomingTextWebhookUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Lightweight identity returned by list and update endpoints. */
export interface AgentIdentitySummary {
  id: string;
  organizationId: string;
  agentHandle: string;
  /** Email address assigned at creation time. Always trust this value — do not derive it from `agentHandle`. */
  emailAddress: string | null;
  walletId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** @internal Full identity data with channels — users interact with AgentIdentity (the class) instead. */
export interface _AgentIdentityData extends AgentIdentitySummary {
  /** Mailbox assigned to this identity, or null if unlinked. */
  mailbox: IdentityMailbox | null;
  /** Phone number assigned to this identity, or null if unlinked. */
  phoneNumber: IdentityPhoneNumber | null;
  /** Wallet assigned to this identity, or null if unlinked. */
  wallet: AgentWallet | null;
}

// ---- internal raw API shapes (snake_case from JSON) ----

export interface RawIdentityMailbox {
  id: string;
  email_address: string;
  display_name: string | null;
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
  incoming_text_webhook_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawAgentIdentitySummary {
  id: string;
  organization_id: string;
  agent_handle: string;
  email_address: string | null;
  wallet_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawAgentIdentityData extends RawAgentIdentitySummary {
  mailbox: RawIdentityMailbox | null;
  phone_number: RawIdentityPhoneNumber | null;
  wallet: RawAgentWallet | null;
}

// ---- parsers ----

export function parseIdentityMailbox(r: RawIdentityMailbox): IdentityMailbox {
  return {
    id: r.id,
    emailAddress: r.email_address,
    displayName: r.display_name,
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
    incomingTextWebhookUrl: r.incoming_text_webhook_url ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseAgentIdentitySummary(r: RawAgentIdentitySummary): AgentIdentitySummary {
  return {
    id: r.id,
    organizationId: r.organization_id,
    agentHandle: r.agent_handle,
    emailAddress: r.email_address,
    walletId: r.wallet_id,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseAgentIdentityData(r: RawAgentIdentityData): _AgentIdentityData {
  return {
    ...parseAgentIdentitySummary(r),
    mailbox: r.mailbox ? parseIdentityMailbox(r.mailbox) : null,
    phoneNumber: r.phone_number ? parseIdentityPhoneNumber(r.phone_number) : null,
    wallet: r.wallet ? parseAgentWallet(r.wallet) : null,
  };
}

export function identityMailboxCreateOptionsToWire(
  options: IdentityMailboxCreateOptions,
): Record<string, string> {
  const body: Record<string, string> = {};
  if (options.displayName !== undefined) body["display_name"] = options.displayName;
  if (options.emailLocalPart !== undefined) body["email_local_part"] = options.emailLocalPart;
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

export function identityWalletCreateOptionsToWire(
  options: IdentityWalletCreateOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (options.chains !== undefined) body["chains"] = options.chains;
  return body;
}

export function vaultSecretIdsToWire(
  value: string | string[] | "*" | "all" | undefined,
): string | string[] | "*" | "all" | undefined {
  return value;
}
