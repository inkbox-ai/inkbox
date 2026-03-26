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
import { MessageDirection } from "./mail/types.js";
import type { Message, MessageDetail, ThreadDetail } from "./mail/types.js";
import type {
  PhoneCall,
  PhoneCallWithRateLimit,
  PhoneTranscript,
  TextConversationSummary,
  TextMessage,
} from "./phone/types.js";
import type {
  AgentIdentitySummary,
  _AgentIdentityData,
  IdentityMailbox,
  IdentityPhoneNumber,
} from "./identities/types.js";
import type { Inkbox } from "./inkbox.js";

export class AgentIdentity {
  private _data: _AgentIdentityData;
  private readonly _inkbox: Inkbox;
  private _mailbox: IdentityMailbox | null;
  private _phoneNumber: IdentityPhoneNumber | null;
  private _credentials: Credentials | null = null;
  private _credentialsVaultRef: object | null = null; // tracks which _unlocked built the cache

  constructor(data: _AgentIdentityData, inkbox: Inkbox) {
    this._data              = data;
    this._inkbox            = inkbox;
    this._mailbox           = data.mailbox;
    this._phoneNumber       = data.phoneNumber;
  }

  // ------------------------------------------------------------------
  // Identity properties
  // ------------------------------------------------------------------

  get agentHandle(): string { return this._data.agentHandle; }
  get id(): string           { return this._data.id; }
  get status(): string       { return this._data.status; }

  /** The mailbox currently assigned to this identity, or `null` if none. */
  get mailbox(): IdentityMailbox | null { return this._mailbox; }

  /** The phone number currently assigned to this identity, or `null` if none. */
  get phoneNumber(): IdentityPhoneNumber | null { return this._phoneNumber; }

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
    // Filter secrets by identity access rules (same logic as
    // VaultResource.unlock with identityId).
    const idStr = this.id;
    const filtered = [];
    for (const secret of unlocked.secrets) {
      const rules = await vault.http.get<
        Array<{ id: string; vault_secret_id: string; identity_id: string; created_at: string }>
      >(`/secrets/${secret.id}/access`);
      if (rules.some((r) => r.identity_id === idStr)) {
        filtered.push(secret);
      }
    }
    this._credentials = new Credentials(filtered);
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
   * Create a new mailbox and link it to this identity.
   *
   * @param options.displayName - Optional human-readable sender name.
   * @returns The newly created and linked {@link IdentityMailbox}.
   */
  async createMailbox(options: { displayName?: string } = {}): Promise<IdentityMailbox> {
    const mailbox = await this._inkbox._mailboxes.create({
      agentHandle: this.agentHandle,
      ...options,
    });
    const linked: IdentityMailbox = {
      id: mailbox.id,
      emailAddress: mailbox.emailAddress,
      displayName: mailbox.displayName,
      status: mailbox.status,
      createdAt: mailbox.createdAt,
      updatedAt: mailbox.updatedAt,
    };
    this._mailbox = linked;
    return linked;
  }

  /**
   * Link an existing mailbox to this identity.
   *
   * @param mailboxId - UUID of the mailbox to link. Obtain via
   *   `inkbox.mailboxes.list()` or `inkbox.mailboxes.get()`.
   * @returns The linked {@link IdentityMailbox}.
   */
  async assignMailbox(mailboxId: string): Promise<IdentityMailbox> {
    const data    = await this._inkbox._idsResource.assignMailbox(this.agentHandle, {
      mailboxId,
    });
    this._mailbox  = data.mailbox;
    this._data     = data;
    return this._mailbox!;
  }

  /**
   * Unlink this identity's mailbox (does not delete the mailbox).
   */
  async unlinkMailbox(): Promise<void> {
    this._requireMailbox();
    await this._inkbox._idsResource.unlinkMailbox(this.agentHandle);
    this._mailbox = null;
  }

  /**
   * Provision a new phone number and link it to this identity.
   *
   * @param options.type - `"toll_free"` (default) or `"local"`.
   * @param options.state - US state abbreviation (e.g. `"NY"`), valid for local numbers only.
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
   * Link an existing phone number to this identity.
   *
   * @param phoneNumberId - UUID of the phone number to link. Obtain via
   *   `inkbox.phoneNumbers.list()` or `inkbox.phoneNumbers.get()`.
   * @returns The linked {@link IdentityPhoneNumber}.
   */
  async assignPhoneNumber(phoneNumberId: string): Promise<IdentityPhoneNumber> {
    const data   = await this._inkbox._idsResource.assignPhoneNumber(this.agentHandle, {
      phoneNumberId,
    });
    this._phoneNumber = data.phoneNumber;
    this._data        = data;
    return this._phoneNumber!;
  }

  /**
   * Unlink this identity's phone number (does not release the number).
   */
  async unlinkPhoneNumber(): Promise<void> {
    this._requirePhone();
    await this._inkbox._idsResource.unlinkPhoneNumber(this.agentHandle);
    this._phoneNumber = null;
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
    attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
  }): Promise<Message> {
    this._requireMailbox();
    return this._inkbox._messages.send(this._mailbox!.emailAddress, options);
  }

  /**
   * Iterate over emails in this identity's inbox, newest first.
   *
   * Pagination is handled automatically.
   *
   * @param options.pageSize - Messages fetched per API call (1–100). Defaults to 50.
   * @param options.direction - Filter by `"inbound"` or `"outbound"`.
   */
  iterEmails(options: { pageSize?: number; direction?: MessageDirection } = {}): AsyncGenerator<Message> {
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
  async *iterUnreadEmails(options: { pageSize?: number; direction?: MessageDirection } = {}): AsyncGenerator<Message> {
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
   * Place an outbound call from this identity's phone number.
   *
   * @param options.toNumber - E.164 destination number.
   * @param options.clientWebsocketUrl - WebSocket URL (wss://) for audio bridging.
   */
  async placeCall(options: {
    toNumber: string;
    clientWebsocketUrl?: string;
  }): Promise<PhoneCallWithRateLimit> {
    this._requirePhone();
    return this._inkbox._calls.place({
      fromNumber:          this._phoneNumber!.number,
      toNumber:            options.toNumber,
      clientWebsocketUrl:  options.clientWebsocketUrl,
    });
  }

  /**
   * List calls made to/from this identity's phone number.
   *
   * @param options.limit - Maximum number of results. Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   */
  async listCalls(options: { limit?: number; offset?: number } = {}): Promise<PhoneCall[]> {
    this._requirePhone();
    return this._inkbox._calls.list(this._phoneNumber!.id, options);
  }

  /**
   * List transcript segments for a specific call.
   *
   * @param callId - ID of the call to fetch transcripts for.
   */
  async listTranscripts(callId: string): Promise<PhoneTranscript[]> {
    this._requirePhone();
    return this._inkbox._transcripts.list(this._phoneNumber!.id, callId);
  }

  // ------------------------------------------------------------------
  // Text message helpers
  // ------------------------------------------------------------------

  /**
   * List text messages for this identity's phone number.
   *
   * @param options.limit - Maximum number of results. Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isRead - Filter by read state.
   */
  async listTexts(
    options?: { limit?: number; offset?: number; isRead?: boolean },
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
   * List text conversations (one row per remote number).
   *
   * @param options.limit - Maximum number of results. Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   */
  async listTextConversations(
    options?: { limit?: number; offset?: number },
  ): Promise<TextConversationSummary[]> {
    this._requirePhone();
    return this._inkbox._texts.listConversations(this._phoneNumber!.id, options);
  }

  /**
   * Get all messages with a specific remote number.
   *
   * @param remoteNumber - E.164 remote phone number.
   * @param options.limit - Maximum number of results. Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   */
  async getTextConversation(
    remoteNumber: string,
    options?: { limit?: number; offset?: number },
  ): Promise<TextMessage[]> {
    this._requirePhone();
    return this._inkbox._texts.getConversation(this._phoneNumber!.id, remoteNumber, options);
  }

  // ------------------------------------------------------------------
  // Identity management
  // ------------------------------------------------------------------

  /**
   * Update this identity's handle or status.
   *
   * @param options.newHandle - New agent handle.
   * @param options.status - New lifecycle status: `"active"` or `"paused"`.
   */
  async update(options: { newHandle?: string; status?: string }): Promise<void> {
    const result = await this._inkbox._idsResource.update(this.agentHandle, options);
    this._data = {
      ...result,
      mailbox:          this._mailbox,
      phoneNumber:      this._phoneNumber,
    };
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
    this._credentials      = null;
    return this;
  }

  /** Delete this identity (unlinks channels without deleting them). */
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
        `Identity '${this.agentHandle}' has no mailbox assigned. Call identity.createMailbox() or identity.assignMailbox() first.`,
      );
    }
  }

  private _requirePhone(): void {
    if (!this._phoneNumber) {
      throw new InkboxError(
        `Identity '${this.agentHandle}' has no phone number assigned. Call identity.provisionPhoneNumber() or identity.assignPhoneNumber() first.`,
      );
    }
  }

}
