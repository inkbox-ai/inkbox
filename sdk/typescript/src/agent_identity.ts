/**
 * inkbox/src/agent.ts
 *
 * AgentIdentity — a domain object representing one agent identity.
 * Returned by inkbox.createIdentity() and inkbox.getIdentity().
 *
 * Convenience methods (sendEmail, placeCall, etc.) are scoped to this
 * identity's assigned channels so callers never need to pass an email
 * address or phone number ID explicitly.
 */

import { InkboxAPIError, InkboxError } from "./_http.js";
import { Credentials } from "./credentials.js";
import type { TOTPCode, TOTPConfig } from "./vault/totp.js";
import type { DecryptedVaultSecret, SecretPayload, VaultSecret } from "./vault/types.js";
import { ForwardMode, MessageDirection } from "./mail/types.js";
import type {
  FilterMode,
  MailIdentityContactRule,
  Message,
  MessageDetail,
  ThreadDetail,
} from "./mail/types.js";
import type {
  PhoneIdentityContactRule,
  IncomingCallActionConfig,
  HostedAgentConfig,
} from "./phone/types.js";
import { CallMode, CallOrigin, IncomingCallAction } from "./phone/types.js";
import type {
  CreateMailIdentityContactRuleOptions,
  ListMailIdentityContactRulesOptions,
  UpdateMailIdentityContactRuleOptions,
} from "./mail/resources/identityContactRules.js";
import type {
  CreatePhoneIdentityContactRuleOptions,
  ListPhoneIdentityContactRulesOptions,
  UpdatePhoneIdentityContactRuleOptions,
} from "./phone/resources/identityContactRules.js";
import type { SigningKey, SigningKeyStatus } from "./signing_keys.js";
import type {
  IMessage,
  IMessageAssignment,
  IMessageConversation,
  IMessageConversationSummary,
  IMessageMarkReadResult,
  IMessageMediaUpload,
  IMessageReaction,
  IMessageReactionType,
  IMessageSendStyle,
} from "./imessage/types.js";
import type {
  PhoneCall,
  PhoneCallWithRateLimit,
  PhoneTranscript,
  TextConversationSummary,
  TextConversationUpdateResult,
  TextMessage,
} from "./phone/types.js";
import type {
  _AgentIdentityData,
  IdentityAccess,
  IdentityMailbox,
  IdentityPhoneNumber,
} from "./identities/types.js";
import type { Tunnel } from "./tunnels/types.js";
import type { Inkbox } from "./inkbox.js";

export class AgentIdentity {
  private _data: _AgentIdentityData;
  private readonly _inkbox: Inkbox;
  private _mailbox: IdentityMailbox | null;
  private _phoneNumber: IdentityPhoneNumber | null;
  private _tunnel: Tunnel | null;
  private _credentials: Credentials | null = null;
  private _credentialsVaultRef: object | null = null; // tracks which _unlocked built the cache

  constructor(data: _AgentIdentityData, inkbox: Inkbox) {
    this._data              = data;
    this._inkbox            = inkbox;
    this._mailbox           = data.mailbox;
    this._phoneNumber       = data.phoneNumber;
    this._tunnel            = data.tunnel;
  }

  // ------------------------------------------------------------------
  // Identity properties
  // ------------------------------------------------------------------

  get agentHandle(): string { return this._data.agentHandle; }
  get id(): string           { return this._data.id; }

  /** Human-readable display name. Defaults server-side to `agentHandle` if unset. */
  get displayName(): string | null { return this._data.displayName; }

  /** Free-form org-internal description, or `null` if unset. Never surfaces in outbound mail. */
  get description(): string | null { return this._data.description; }

  /** Email address assigned at creation time. Always trust this value — do not derive it from `agentHandle`. */
  get emailAddress(): string | null { return this._data.emailAddress; }

  /** Whether this identity can be reached over the shared iMessage service. */
  get imessageEnabled(): boolean { return this._data.imessageEnabled; }

  /** Whitelist/blacklist mode for this identity's iMessage contact rules. */
  get imessageFilterMode(): FilterMode { return this._data.imessageFilterMode; }

  /** Whitelist/blacklist mode for this identity's mail contact rules. */
  get mailFilterMode(): FilterMode { return this._data.mailFilterMode; }

  /** Whitelist/blacklist mode for this identity's phone contact rules. */
  get phoneFilterMode(): FilterMode { return this._data.phoneFilterMode; }

  /** Whether this identity has a webhook signing key configured. Status only — never the secret. */
  get signingKeyConfigured(): boolean { return this._data.signingKeyConfigured; }

  /** When this identity's signing key was created, or `null` if none is configured. */
  get signingKeyCreatedAt(): Date | null { return this._data.signingKeyCreatedAt; }

  /** The mailbox currently assigned to this identity. Non-null for live identities (1:1 invariant). */
  get mailbox(): IdentityMailbox | null { return this._mailbox; }

  /** The phone number currently assigned to this identity, or `null` if none. */
  get phoneNumber(): IdentityPhoneNumber | null { return this._phoneNumber; }

  /** The tunnel currently assigned to this identity. Non-null for live identities (1:1 invariant). */
  get tunnel(): Tunnel | null { return this._tunnel; }

  /**
   * Identity-scoped credential access.
   *
   * Returns a {@link Credentials} object filtered to the secrets this
   * identity has been granted access to. The vault must be unlocked
   * first via `inkbox.vault.unlock(vaultKey)`.
   *
   * The result is cached and automatically invalidated when the
   * vault is re-unlocked.  Call {@link refresh} to manually clear
   * the cache (e.g. after access-rule changes).
   *
   * @throws Error if the vault has not been unlocked.
   */
  async getCredentials(): Promise<Credentials> {
    // If the vault was unlocked via constructor vaultKey, wait for it.
    if (this._inkbox._vaultUnlockPromise !== null) {
      await this._inkbox._vaultUnlockPromise;
    }
    const vault = this._inkbox._vaultResource;
    // Invalidate cache if the vault was re-unlocked since we last built it.
    if (this._credentials !== null && vault._unlocked === this._credentialsVaultRef) {
      return this._credentials;
    }
    this._requireVaultUnlocked();
    const unlocked = vault._unlocked!;
    this._credentials = new Credentials(unlocked.secrets);
    this._credentialsVaultRef = unlocked;
    return this._credentials;
  }

  /**
   * Revoke this identity's access to a vault secret.
   *
   * Also clears the credentials cache so the next call to
   * {@link getCredentials} reflects the change.
   *
   * @param secretId - UUID of the secret to revoke access from.
   */
  async revokeCredentialAccess(secretId: string): Promise<void> {
    await this._inkbox._vaultResource.revokeAccess(secretId, this.id);
    this._credentials = null;
  }

  // ------------------------------------------------------------------
  // Vault secret management
  // ------------------------------------------------------------------

  /**
   * Create a vault secret and grant this identity access to it.
   *
   * The vault must be unlocked first.
   *
   * @param options.name - Display name (max 255 characters).
   * @param options.payload - The secret payload.
   * @param options.description - Optional description.
   * @returns {@link VaultSecret} metadata.
   */
  async createSecret(options: {
    name: string;
    payload: SecretPayload;
    description?: string;
  }): Promise<VaultSecret> {
    this._requireVaultUnlocked();
    const unlocked = this._inkbox._vaultResource._unlocked!;
    const secret = await unlocked.createSecret(options);
    await this._inkbox._vaultResource.grantAccess(secret.id, this.id);
    this._credentials = null;
    return secret;
  }

  /**
   * Fetch and decrypt a vault secret this identity has access to.
   *
   * @param secretId - UUID of the secret.
   */
  async getSecret(secretId: string): Promise<DecryptedVaultSecret> {
    this._requireVaultUnlocked();
    return this._inkbox._vaultResource._unlocked!.getSecret(secretId);
  }

  /**
   * Add or replace TOTP on a login secret this identity has access to.
   *
   * @param secretId - UUID of the login secret.
   * @param totp - A {@link TOTPConfig} or an `otpauth://totp/...` URI string.
   * @returns Updated {@link VaultSecret} metadata.
   */
  async setTotp(secretId: string, totp: TOTPConfig | string): Promise<VaultSecret> {
    this._requireVaultUnlocked();
    const result = await this._inkbox._vaultResource._unlocked!.setTotp(secretId, totp);
    this._credentials = null;
    return result;
  }

  /**
   * Remove TOTP from a login secret this identity has access to.
   *
   * @param secretId - UUID of the login secret.
   * @returns Updated {@link VaultSecret} metadata.
   */
  async removeTotp(secretId: string): Promise<VaultSecret> {
    this._requireVaultUnlocked();
    const result = await this._inkbox._vaultResource._unlocked!.removeTotp(secretId);
    this._credentials = null;
    return result;
  }

  /**
   * Generate the current TOTP code for a login secret.
   *
   * Uses cached credentials if available, otherwise fetches fresh.
   *
   * @param secretId - UUID of the login secret.
   * @returns A {@link TOTPCode}.
   */
  async getTotpCode(secretId: string): Promise<TOTPCode> {
    this._requireVaultUnlocked();
    return this._inkbox._vaultResource._unlocked!.getTotpCode(secretId);
  }

  /**
   * Delete a vault secret.
   *
   * @param secretId - UUID of the secret to delete.
   */
  async deleteSecret(secretId: string): Promise<void> {
    this._requireVaultUnlocked();
    await this._inkbox._vaultResource._unlocked!.deleteSecret(secretId);
    this._credentials = null;
  }

  // ------------------------------------------------------------------
  // Channel management
  // ------------------------------------------------------------------

  /**
   * Provision a new phone number and link it to this identity.
   *
   * @param options.type - Number type to provision. Only `"local"` is supported. Defaults to `"local"`.
   * @param options.state - US state abbreviation (e.g. `"NY"`) to request a number in that state.
   * @returns The newly provisioned and linked {@link IdentityPhoneNumber}.
   */
  async provisionPhoneNumber(
    options: { type?: string; state?: string } = {},
  ): Promise<IdentityPhoneNumber> {
    await this._inkbox._numbers.provision({ agentHandle: this.agentHandle, ...options });
    const data = await this._inkbox._idsResource.get(this.agentHandle);
    this._phoneNumber = data.phoneNumber;
    this._data        = data;
    return this._phoneNumber!;
  }

  /**
   * Release this identity's phone number (vendor + local).
   */
  async releasePhoneNumber(): Promise<void> {
    this._requirePhone();
    await this._inkbox._idsResource.releasePhoneNumber(this.agentHandle);
    this._phoneNumber = null;
  }

  // ------------------------------------------------------------------
  // Identity access / visibility
  // ------------------------------------------------------------------

  /**
   * List who can see this identity.
   *
   * See {@link IdentitiesResource.listAccess}.
   */
  async listAccess(): Promise<IdentityAccess[]> {
    return this._inkbox._idsResource.listAccess(this.agentHandle);
  }

  /**
   * Grant visibility on this identity.
   *
   * @param viewerIdentityId - UUID of the viewer identity to grant, or
   *   `null` to reset this identity to the org-wide wildcard (every
   *   active identity in the org sees it).
   */
  async grantAccess(viewerIdentityId: string | null): Promise<IdentityAccess> {
    return this._inkbox._idsResource.grantAccess(this.agentHandle, viewerIdentityId);
  }

  /**
   * Revoke one viewer's visibility on this identity.
   *
   * @param viewerIdentityId - UUID of the viewer identity to drop
   *   (the viewer identity's UUID, not an access-row id).
   */
  async revokeAccess(viewerIdentityId: string): Promise<void> {
    await this._inkbox._idsResource.revokeAccess(this.agentHandle, viewerIdentityId);
  }

  // ------------------------------------------------------------------
  // Mail helpers
  // ------------------------------------------------------------------

  /**
   * Send an email from this identity's mailbox.
   *
   * @param options.to - Primary recipient addresses (at least one required).
   * @param options.subject - Email subject line.
   * @param options.bodyText - Plain-text body.
   * @param options.bodyHtml - HTML body.
   * @param options.cc - Carbon-copy recipients.
   * @param options.bcc - Blind carbon-copy recipients.
   * @param options.inReplyToMessageId - RFC 5322 Message-ID to thread a reply.
   * @param options.attachments - File attachments.
   */
  async sendEmail(options: {
    to: string[];
    subject: string;
    bodyText?: string;
    bodyHtml?: string;
    cc?: string[];
    bcc?: string[];
    inReplyToMessageId?: string;
    /** `contentId` on an entry renders it inline in the HTML body (`cid:<contentId>`); requires `bodyHtml` + `image/*`. */
    attachments?: Array<{ filename: string; contentType: string; contentBase64: string; contentId?: string }>;
    /** Embed an open-tracking pixel when `bodyHtml` is present; opens surface as `firstOpenedAt`/`openCount`. */
    trackOpens?: boolean;
  }): Promise<Message> {
    this._requireMailbox();
    return this._inkbox._messages.send(this._mailbox!.emailAddress, options);
  }

  /**
   * Reply to everyone on a stored message from this identity's mailbox.
   *
   * @param messageId - UUID of the message being replied to.
   * @param options.subject - Optional subject override.
   * @param options.bodyText - Plain-text reply body.
   * @param options.bodyHtml - HTML reply body.
   * @param options.attachments - File attachments.
   * @param options.replyTo - Optional Reply-To address.
   */
  async replyAllEmail(
    messageId: string,
    options: {
      subject?: string;
      bodyText?: string;
      bodyHtml?: string;
      /** `contentId` on an entry renders it inline in the HTML body (`cid:<contentId>`); requires `bodyHtml` + `image/*`. */
      attachments?: Array<{ filename: string; contentType: string; contentBase64: string; contentId?: string }>;
      replyTo?: string;
    } = {},
  ): Promise<Message> {
    this._requireMailbox();
    return this._inkbox._messages.replyAll(
      this._mailbox!.emailAddress,
      messageId,
      options,
    );
  }

  /**
   * Forward a stored message out from this identity's mailbox.
   *
   * @param messageId - UUID of the message being forwarded.
   * @param options.to - Primary recipient addresses.
   * @param options.cc - Carbon-copy recipients.
   * @param options.bcc - Blind carbon-copy recipients. At least one address
   *   is required across `to`, `cc`, and `bcc`.
   * @param options.mode - `"inline"` (default) or `"wrapped"`.
   * @param options.subject - Optional override; defaults to
   *   `"Fwd: " + original.subject`.
   * @param options.bodyText - Optional caller note prepended above the
   *   original body (inline) or as a top-level note (wrapped).
   * @param options.bodyHtml - Optional HTML caller note.
   * @param options.additionalAttachments - Optional caller-authored
   *   attachments alongside the forwarded content.
   * @param options.includeOriginalAttachments - `inline` mode only. When
   *   `true` (default), original attachments are re-attached. Ignored in
   *   `wrapped` mode.
   * @param options.replyTo - Optional Reply-To address.
   */
  async forwardEmail(
    messageId: string,
    options: {
      to?: string[];
      cc?: string[];
      bcc?: string[];
      mode?: ForwardMode | "inline" | "wrapped";
      subject?: string;
      bodyText?: string;
      bodyHtml?: string;
      additionalAttachments?: Array<{
        filename: string;
        contentType: string;
        contentBase64: string;
      }>;
      includeOriginalAttachments?: boolean;
      replyTo?: string;
      /** Embed an open-tracking pixel (requires an HTML part on the forward). */
      trackOpens?: boolean;
    },
  ): Promise<Message> {
    this._requireMailbox();
    return this._inkbox._messages.forward(
      this._mailbox!.emailAddress,
      messageId,
      options,
    );
  }

  /**
   * Iterate over emails in this identity's inbox, newest first.
   *
   * Pagination is handled automatically.
   *
   * @param options.pageSize - Messages fetched per API call (1–100). Defaults to 50.
   * @param options.direction - Filter by `"inbound"` or `"outbound"`.
   */
  iterEmails(options: { pageSize?: number; direction?: MessageDirection; startDatetime?: string; endDatetime?: string; tz?: string } = {}): AsyncGenerator<Message> {
    this._requireMailbox();
    return this._inkbox._messages.list(this._mailbox!.emailAddress, options);
  }

  /**
   * Iterate over unread emails in this identity's inbox, newest first.
   *
   * Fetches all messages and filters client-side. Pagination is handled automatically.
   *
   * @param options.pageSize - Messages fetched per API call (1–100). Defaults to 50.
   * @param options.direction - Filter by `"inbound"` or `"outbound"`.
   */
  async *iterUnreadEmails(options: { pageSize?: number; direction?: MessageDirection; startDatetime?: string; endDatetime?: string; tz?: string } = {}): AsyncGenerator<Message> {
    for await (const msg of this.iterEmails(options)) {
      if (!msg.isRead) yield msg;
    }
  }

  /**
   * Mark a list of messages as read.
   *
   * @param messageIds - IDs of the messages to mark as read.
   */
  async markEmailsRead(messageIds: string[]): Promise<void> {
    this._requireMailbox();
    for (const id of messageIds) {
      await this._inkbox._messages.markRead(this._mailbox!.emailAddress, id);
    }
  }

  /**
   * Mark a list of messages as unread.
   *
   * @param messageIds - IDs of the messages to mark as unread.
   */
  async markEmailsUnread(messageIds: string[]): Promise<void> {
    this._requireMailbox();
    for (const id of messageIds) {
      await this._inkbox._messages.markUnread(this._mailbox!.emailAddress, id);
    }
  }

  /**
   * Get a single message with full body content.
   *
   * @param messageId - UUID of the message to fetch. Obtain via `msg.id`
   *   on any {@link Message}.
   */
  async getMessage(messageId: string): Promise<MessageDetail> {
    this._requireMailbox();
    return this._inkbox._messages.get(this._mailbox!.emailAddress, messageId);
  }

  /**
   * Get a thread with all its messages inlined (oldest-first).
   *
   * @param threadId - UUID of the thread to fetch. Obtain via `msg.threadId`
   *   on any {@link Message}.
   */
  async getThread(threadId: string): Promise<ThreadDetail> {
    this._requireMailbox();
    return this._inkbox._threads.get(this._mailbox!.emailAddress, threadId);
  }

  // ------------------------------------------------------------------
  // Phone helpers
  // ------------------------------------------------------------------

  /**
   * Place an outbound call for this identity.
   *
   * For `dedicated_number` origination (the default) the call is placed
   * from this identity's own phone number (requires one to be assigned).
   * For `shared_imessage_number` origination the call rides the shared
   * pool and is scoped by this identity's id — no dedicated number needed.
   *
   * @param options.toNumber - E.164 destination number.
   * @param options.origination - Where the call originates. Defaults to
   *   `dedicated_number`.
   * @param options.clientWebsocketUrl - WebSocket URL (wss://) for audio bridging.
   * @param options.mode - Who drives the call. Defaults to `client_websocket`.
   * @param options.reason - The hosted agent's task brief for the call.
   *   Required with `mode=hosted_agent`, invalid otherwise (server 422).
   */
  async placeCall(options: {
    toNumber: string;
    origination?: CallOrigin;
    clientWebsocketUrl?: string;
    mode?: CallMode;
    reason?: string;
  }): Promise<PhoneCallWithRateLimit> {
    const origination = options.origination ?? CallOrigin.DEDICATED_NUMBER;
    if (origination === CallOrigin.DEDICATED_NUMBER) {
      // Dedicated calls need this identity's own number as the sender.
      this._requirePhone();
      return this._inkbox._calls.place({
        toNumber:            options.toNumber,
        origination,
        fromNumber:          this._phoneNumber!.number,
        clientWebsocketUrl:  options.clientWebsocketUrl,
        mode:                options.mode,
        reason:              options.reason,
      });
    }
    // Shared-pool calls scope by identity id; no from_number.
    return this._inkbox._calls.place({
      toNumber:            options.toNumber,
      origination,
      agentIdentityId:     this.id,
      clientWebsocketUrl:  options.clientWebsocketUrl,
      mode:                options.mode,
      reason:              options.reason,
    });
  }

  /**
   * List calls for this identity, newest first.
   *
   * Identity-scoped credentials never see contact-rule-blocked rows
   * regardless of `isBlocked` (server-side access policy).
   *
   * @param options.limit - Maximum number of results. Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isBlocked - Tri-state filter. `true` for only blocked,
   *   `false` for only non-blocked, omit for all.
   */
  async listCalls(
    options: { limit?: number; offset?: number; isBlocked?: boolean; startDatetime?: string; endDatetime?: string; tz?: string } = {},
  ): Promise<PhoneCall[]> {
    // Scope by identity id — no phone number required (a shared-only
    // identity can still have calls).
    return this._inkbox._calls.list({ agentIdentityId: this.id, ...options });
  }

  /**
   * List transcript segments for a specific call.
   *
   * @param callId - ID of the call to fetch transcripts for.
   */
  async listTranscripts(callId: string): Promise<PhoneTranscript[]> {
    return this._inkbox._calls.transcripts(callId);
  }

  /**
   * Hang up one of this identity's live calls, from outside the call.
   *
   * @param callId - ID of the call to hang up.
   */
  async hangupCall(callId: string): Promise<PhoneCall> {
    return this._inkbox._calls.hangup(callId);
  }

  /** Get this identity's hosted call agent config. */
  async getHostedAgentConfig(): Promise<HostedAgentConfig> {
    return this._inkbox._hostedAgent.getConfig({ agentIdentityId: this.id });
  }

  /**
   * Set this identity's hosted call agent config (full replace).
   *
   * A field left undefined resets to the server default.
   *
   * @param options.voice - Voice override; omit for the server default.
   * @param options.model - Model override; omit for the server default.
   * @param options.instructions - Per-identity steering prompt; omit for none.
   */
  async setHostedAgentConfig(options?: {
    voice?: string;
    model?: string;
    instructions?: string;
  }): Promise<HostedAgentConfig> {
    return this._inkbox._hostedAgent.setConfig({
      voice: options?.voice,
      model: options?.model,
      instructions: options?.instructions,
      agentIdentityId: this.id,
    });
  }

  /** Get this identity's inbound-call handling config. */
  async getIncomingCallAction(): Promise<IncomingCallActionConfig> {
    return this._inkbox._incomingCallAction.get({ agentIdentityId: this.id });
  }

  /** Set this identity's inbound-call handling config. */
  async setIncomingCallAction(options: {
    incomingCallAction: IncomingCallAction;
    clientWebsocketUrl?: string;
    incomingCallWebhookUrl?: string;
  }): Promise<IncomingCallActionConfig> {
    return this._inkbox._incomingCallAction.set({
      incomingCallAction: options.incomingCallAction,
      agentIdentityId: this.id,
      clientWebsocketUrl: options.clientWebsocketUrl,
      incomingCallWebhookUrl: options.incomingCallWebhookUrl,
    });
  }

  // ------------------------------------------------------------------
  // Text message helpers
  // ------------------------------------------------------------------

  /**
   * Send an outbound SMS/MMS from this identity's phone number.
   *
   * The returned message is in `queued` state. The full outbound
   * lifecycle (`text.sent` → `text.delivered` / `text.delivery_failed`
   * / `text.delivery_unconfirmed`) arrives via any webhook
   * subscription on the sender's phone number whose `eventTypes`
   * include those lifecycle events
   * (`inkbox.webhooks.subscriptions.create({ phoneNumberId, url,
   * eventTypes })`). See `TextWebhookEventType` and `TextWebhookPayload`
   * for the typed receiver-side shapes.
   *
   * @param options.to - E.164 destination number, or numbers for a group send.
   *   Mutually exclusive with `conversationId`.
   * @param options.conversationId - Existing conversation UUID to reply into.
   *   The server resolves it to that conversation's participants.
   * @param options.text - Message body.
   * @param options.mediaUrls - MMS media URLs.
   *
   * @throws {InkboxError} when this identity has no phone number.
   * @throws {RecipientBlockedError} when the destination is blocked by an
   *   outbound contact rule.
   * @throws {InkboxAPIError} for other send failures.
   */
  async sendText(options: {
    to?: string | string[] | null;
    conversationId?: string | null;
    text?: string | null;
    mediaUrls?: string[] | null;
  }): Promise<TextMessage> {
    this._requirePhone();
    return this._inkbox._texts.send(this._phoneNumber!.id, options);
  }

  /**
   * List text messages for this identity's phone number.
   *
   * Identity-scoped credentials never see contact-rule-blocked rows
   * regardless of `isBlocked` (server-side access policy).
   *
   * @param options.limit - Maximum number of results. Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isRead - Filter by read state.
   * @param options.isBlocked - Tri-state filter. `true` for only blocked,
   *   `false` for only non-blocked, omit for all.
   */
  async listTexts(
    options?: {
      limit?: number;
      offset?: number;
      isRead?: boolean;
      isBlocked?: boolean;
      startDatetime?: string;
      endDatetime?: string;
      tz?: string;
    },
  ): Promise<TextMessage[]> {
    this._requirePhone();
    return this._inkbox._texts.list(this._phoneNumber!.id, options);
  }

  /**
   * Get a single text message by ID.
   *
   * @param textId - UUID of the text message to fetch.
   */
  async getText(textId: string): Promise<TextMessage> {
    this._requirePhone();
    return this._inkbox._texts.get(this._phoneNumber!.id, textId);
  }

  /**
   * List text conversations.
   *
   * Identity-scoped credentials never see blocked rows in conversation
   * summaries; admin/JWT can pass `isBlocked=false` to hide spam-only
   * counterparties or `isBlocked=true` to narrow to conversations made
   * up of blocked rows.
   *
   * @param options.limit - Maximum number of results. Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isBlocked - Tri-state filter. `true` for only blocked,
   *   `false` for only non-blocked, omit for all.
   * @param options.includeGroups - Include group conversations. Defaults to
   *   false so old clients continue to see one-to-one rows only.
   */
  async listTextConversations(
    options?: {
      limit?: number;
      offset?: number;
      isBlocked?: boolean;
      includeGroups?: boolean;
      startDatetime?: string;
      endDatetime?: string;
      tz?: string;
    },
  ): Promise<TextConversationSummary[]> {
    this._requirePhone();
    return this._inkbox._texts.listConversations(this._phoneNumber!.id, options);
  }

  /**
   * Get all messages in a conversation.
   *
   * @param conversationKey - E.164 one-to-one remote number, or conversation UUID.
   * @param options.limit - Maximum number of results. Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   */
  async getTextConversation(
    conversationKey: string,
    options?: { limit?: number; offset?: number },
  ): Promise<TextMessage[]> {
    this._requirePhone();
    return this._inkbox._texts.getConversation(
      this._phoneNumber!.id,
      conversationKey,
      options,
    );
  }

  /**
   * Mark a single text message as read.
   *
   * @param textId - UUID of the text message.
   */
  async markTextRead(textId: string): Promise<TextMessage> {
    this._requirePhone();
    return this._inkbox._texts.update(this._phoneNumber!.id, textId, {
      isRead: true,
    });
  }

  /**
   * Mark all messages in a conversation as read.
   *
   * @param conversationKey - E.164 one-to-one remote number, or conversation UUID.
   * @returns Object with `conversationId`, `remotePhoneNumber`, `isRead`, and `updatedCount`.
   */
  async markTextConversationRead(
    conversationKey: string,
  ): Promise<TextConversationUpdateResult> {
    this._requirePhone();
    return this._inkbox._texts.updateConversation(
      this._phoneNumber!.id,
      conversationKey,
      { isRead: true },
    );
  }

  // ------------------------------------------------------------------
  // iMessage helpers
  // ------------------------------------------------------------------

  /**
   * Send an outbound iMessage as this identity.
   *
   * Sends only work toward recipients that triage has already connected
   * to this identity over the shared iMessage service — there is no
   * cold outreach. Inbound replies and reactions arrive via
   * identity-owned webhook subscriptions
   * (`inkbox.webhooks.subscriptions.create({ agentIdentityId, url,
   * eventTypes: ["imessage.received", ...] })`).
   *
   * @param options.to - E.164 recipient number. Mutually exclusive with
   *   `conversationId`.
   * @param options.conversationId - Existing conversation UUID to reply into.
   * @param options.text - Message body.
   * @param options.mediaUrls - Media URLs (at most one). Use
   *   {@link uploadIMessageMedia} to create one from bytes.
   * @param options.sendStyle - Optional expressive send style.
   *
   * @throws {InkboxError} when this identity is not iMessage-enabled.
   * @throws {InkboxAPIError} 403 when the recipient is blocked by a
   *   contact rule; other send failures.
   */
  async sendIMessage(options: {
    to?: string | null;
    conversationId?: string | null;
    text?: string | null;
    mediaUrls?: string[] | null;
    sendStyle?: IMessageSendStyle | string | null;
  }): Promise<IMessage> {
    this._requireIMessage();
    return this._inkbox._imessages.send({
      ...options,
      agentIdentityId: this.id,
    });
  }

  /**
   * List this identity's iMessages, newest first.
   *
   * Identity-scoped credentials never see contact-rule-blocked rows
   * regardless of `isBlocked` (server-side access policy).
   *
   * @param options.conversationId - Narrow to one conversation.
   * @param options.limit - Maximum number of results. Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isRead - Filter by read state.
   * @param options.isBlocked - Tri-state filter. `true` for only blocked,
   *   `false` for only non-blocked, omit for all.
   */
  async listIMessages(
    options?: {
      conversationId?: string;
      limit?: number;
      offset?: number;
      isRead?: boolean;
      isBlocked?: boolean;
      startDatetime?: string;
      endDatetime?: string;
      tz?: string;
    },
  ): Promise<IMessage[]> {
    this._requireIMessage();
    return this._inkbox._imessages.list({
      ...options,
      agentIdentityId: this.id,
    });
  }

  /**
   * List recipients actively connected to this identity, newest first.
   *
   * @param options.limit - Maximum number of results. Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   */
  async listIMessageAssignments(
    options?: { limit?: number; offset?: number },
  ): Promise<IMessageAssignment[]> {
    this._requireIMessage();
    return this._inkbox._imessages.listAssignments({
      ...options,
      agentIdentityId: this.id,
    });
  }

  /**
   * List this identity's iMessage conversations.
   *
   * @param options.limit - Maximum number of results. Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isBlocked - Tri-state filter applied to the
   *   underlying messages. `true` for only blocked, `false` for only
   *   non-blocked, omit for all.
   */
  async listIMessageConversations(
    options?: {
      limit?: number;
      offset?: number;
      isBlocked?: boolean;
      startDatetime?: string;
      endDatetime?: string;
      tz?: string;
    },
  ): Promise<IMessageConversationSummary[]> {
    this._requireIMessage();
    return this._inkbox._imessages.listConversations({
      ...options,
      agentIdentityId: this.id,
    });
  }

  /**
   * Get one of this identity's iMessage conversations by ID.
   *
   * @param conversationId - UUID of the conversation.
   */
  async getIMessageConversation(
    conversationId: string,
  ): Promise<IMessageConversation> {
    this._requireIMessage();
    return this._inkbox._imessages.getConversation(conversationId, {
      agentIdentityId: this.id,
    });
  }

  /**
   * Send a tapback reaction to a message in one of this identity's
   * conversations.
   *
   * @param options.messageId - UUID of the message being reacted to.
   * @param options.reaction - Tapback kind (see {@link IMessageReactionType}).
   * @param options.partIndex - Part of a multi-part message to react to.
   *   Defaults to 0.
   */
  async sendIMessageReaction(options: {
    messageId: string;
    reaction: IMessageReactionType | string;
    partIndex?: number;
  }): Promise<IMessageReaction> {
    this._requireIMessage();
    return this._inkbox._imessages.sendReaction(options);
  }

  /**
   * Send a read receipt and mark a conversation's inbound messages read.
   *
   * @param conversationId - UUID of the conversation.
   * @returns Object with `conversationId` and `updatedCount`.
   */
  async markIMessageConversationRead(
    conversationId: string,
  ): Promise<IMessageMarkReadResult> {
    this._requireIMessage();
    return this._inkbox._imessages.markConversationRead(conversationId);
  }

  /**
   * Show a typing indicator to a conversation's recipient.
   *
   * @param conversationId - UUID of the conversation.
   */
  async sendIMessageTyping(conversationId: string): Promise<void> {
    this._requireIMessage();
    await this._inkbox._imessages.sendTyping(conversationId);
  }

  /**
   * Upload media and get back a URL usable in `mediaUrls`.
   *
   * @param options.content - Raw file bytes (max 10 MiB).
   * @param options.filename - Original filename, used for type inference.
   * @param options.contentType - Optional MIME type.
   */
  async uploadIMessageMedia(options: {
    content: Uint8Array | Blob;
    filename: string;
    contentType?: string;
  }): Promise<IMessageMediaUpload> {
    this._requireIMessage();
    return this._inkbox._imessages.uploadMedia(options);
  }

  // ------------------------------------------------------------------
  // Mail contact rules
  // ------------------------------------------------------------------

  /** List this identity's mail allow/block rules, newest first. */
  async listMailContactRules(
    options: ListMailIdentityContactRulesOptions = {},
  ): Promise<MailIdentityContactRule[]> {
    return this._inkbox._mailIdentityContactRules.list(this.agentHandle, options);
  }

  /** Get one of this identity's mail contact rules by id. */
  async getMailContactRule(ruleId: string): Promise<MailIdentityContactRule> {
    return this._inkbox._mailIdentityContactRules.get(this.agentHandle, ruleId);
  }

  /** Create a mail allow/block rule for this identity. */
  async createMailContactRule(
    options: CreateMailIdentityContactRuleOptions,
  ): Promise<MailIdentityContactRule> {
    return this._inkbox._mailIdentityContactRules.create(this.agentHandle, options);
  }

  /** Update a mail rule's `action` or `status` (admin-only). */
  async updateMailContactRule(
    ruleId: string,
    options: UpdateMailIdentityContactRuleOptions,
  ): Promise<MailIdentityContactRule> {
    return this._inkbox._mailIdentityContactRules.update(this.agentHandle, ruleId, options);
  }

  /** Delete one of this identity's mail contact rules (admin-only). */
  async deleteMailContactRule(ruleId: string): Promise<void> {
    await this._inkbox._mailIdentityContactRules.delete(this.agentHandle, ruleId);
  }

  // ------------------------------------------------------------------
  // Phone contact rules
  // ------------------------------------------------------------------

  /**
   * List this identity's phone allow/block rules, newest first.
   *
   * Returns `[]` for a phoneless identity; the server requires a phone only
   * for create/get/update/delete, not for list.
   */
  async listPhoneContactRules(
    options: ListPhoneIdentityContactRulesOptions = {},
  ): Promise<PhoneIdentityContactRule[]> {
    return this._inkbox._phoneIdentityContactRules.list(this.agentHandle, options);
  }

  /** Get one of this identity's phone contact rules by id. */
  async getPhoneContactRule(ruleId: string): Promise<PhoneIdentityContactRule> {
    this._requirePhone();
    return this._inkbox._phoneIdentityContactRules.get(this.agentHandle, ruleId);
  }

  /**
   * Create a phone allow/block rule for this identity.
   *
   * @throws {InkboxError} if this identity has no phone number.
   */
  async createPhoneContactRule(
    options: CreatePhoneIdentityContactRuleOptions,
  ): Promise<PhoneIdentityContactRule> {
    this._requirePhone();
    return this._inkbox._phoneIdentityContactRules.create(this.agentHandle, options);
  }

  /** Update a phone rule's `action` or `status` (admin-only). */
  async updatePhoneContactRule(
    ruleId: string,
    options: UpdatePhoneIdentityContactRuleOptions,
  ): Promise<PhoneIdentityContactRule> {
    this._requirePhone();
    return this._inkbox._phoneIdentityContactRules.update(this.agentHandle, ruleId, options);
  }

  /** Delete one of this identity's phone contact rules (admin-only). */
  async deletePhoneContactRule(ruleId: string): Promise<void> {
    this._requirePhone();
    await this._inkbox._phoneIdentityContactRules.delete(this.agentHandle, ruleId);
  }

  // ------------------------------------------------------------------
  // Signing key
  // ------------------------------------------------------------------

  /** Report whether this identity has a webhook signing key. */
  async getSigningKeyStatus(): Promise<SigningKeyStatus> {
    return this._inkbox._signingKeys.getStatus(this.agentHandle);
  }

  /**
   * Create or rotate this identity's webhook signing key.
   *
   * The plaintext `signingKey` is returned **once** — store it securely,
   * it cannot be retrieved again.
   */
  async createSigningKey(): Promise<SigningKey> {
    return this._inkbox._signingKeys.createOrRotate(this.agentHandle);
  }

  // ------------------------------------------------------------------
  // Identity management
  // ------------------------------------------------------------------

  /**
   * Update this identity's handle, display name, description, iMessage
   * reachability, and/or status.
   *
   * Only provided fields are applied; omitted fields are left unchanged.
   * For `displayName` and `description`, explicit `null` clears the column;
   * omitting the key leaves it untouched.
   *
   * @param options.newHandle - New agent handle.
   * @param options.displayName - New display name, or `null` to clear.
   * @param options.description - New description, or `null` to clear.
   * @param options.imessageEnabled - Toggle shared-iMessage reachability.
   * @param options.imessageFilterMode - `"whitelist"` or `"blacklist"`
   *   for iMessage contact rules (admin-only).
   * @param options.mailFilterMode - `"whitelist"` or `"blacklist"` for this
   *   identity's mail contact rules (admin-only). Unlike the deprecated
   *   `mailboxes.update({ filterMode })`, this does not return a
   *   `FilterModeChangeNotice`.
   * @param options.phoneFilterMode - `"whitelist"` or `"blacklist"` for this
   *   identity's phone contact rules (admin-only). Rejected with a 422 when
   *   the identity has no phone number.
   * @param options.status - `"active"` or `"paused"`. Call `delete()`
   *   to remove the identity; `"deleted"` is rejected here.
   */
  async update(options: {
    newHandle?: string;
    displayName?: string | null;
    description?: string | null;
    imessageEnabled?: boolean;
    imessageFilterMode?: "whitelist" | "blacklist";
    mailFilterMode?: "whitelist" | "blacklist";
    phoneFilterMode?: "whitelist" | "blacklist";
    status?: "active" | "paused";
  }): Promise<void> {
    const result = await this._inkbox._idsResource.update(this.agentHandle, options);
    this._data = {
      ...result,
      mailbox:          this._mailbox,
      phoneNumber:      this._phoneNumber,
      tunnel:           this._tunnel,
    };
    if (options.newHandle !== undefined && this._tunnel != null) {
      // The server renames the linked tunnel in the same transaction
      // under the unified handle namespace; refresh to pick up the
      // new tunnelName / publicHost on the cached tunnel.
      await this.refresh();
    }
  }

  /**
   * Re-fetch this identity from the API and update cached channels.
   *
   * Also clears the credentials filter cache so the next call to
   * {@link getCredentials} re-evaluates access rules.  (The cache is
   * also automatically invalidated when the vault is re-unlocked.)
   *
   * @returns `this` for chaining.
   */
  async refresh(): Promise<AgentIdentity> {
    const data             = await this._inkbox._idsResource.get(this.agentHandle);
    this._data             = data;
    this._mailbox          = data.mailbox;
    this._phoneNumber      = data.phoneNumber;
    this._tunnel           = data.tunnel;
    this._credentials      = null;
    return this;
  }

  /**
   * Delete this identity.
   *
   * Cascades: flips the linked mailbox to `deleted`, force-finalizes the
   * linked tunnel to `deleted`, revokes any identity-scoped API keys, and
   * releases any linked phone number (vendor + local).
   */
  async delete(): Promise<void> {
    await this._inkbox._idsResource.delete(this.agentHandle);
  }

  // ------------------------------------------------------------------
  // Internal guards
  // ------------------------------------------------------------------

  private _requireVaultUnlocked(): void {
    if (this._inkbox._vaultResource._unlocked === null) {
      throw new InkboxError(
        "Vault must be unlocked before accessing credentials. Call inkbox.vault.unlock(vaultKey) first.",
      );
    }
  }

  private _requireMailbox(): void {
    if (!this._mailbox) {
      throw new InkboxError(
        `Identity '${this.agentHandle}' has no mailbox — this should only be reachable on a deleted identity.`,
      );
    }
  }

  private _requirePhone(): void {
    if (!this._phoneNumber) {
      throw new InkboxError(
        `Identity '${this.agentHandle}' has no phone number assigned. Call identity.provisionPhoneNumber() first, or pass phoneNumber to createIdentity().`,
      );
    }
  }

  private _requireIMessage(): void {
    if (!this._data.imessageEnabled) {
      throw new InkboxError(
        `Identity '${this.agentHandle}' is not iMessage-enabled. Call identity.update({ imessageEnabled: true }) first, or pass imessageEnabled to createIdentity().`,
      );
    }
  }

}
