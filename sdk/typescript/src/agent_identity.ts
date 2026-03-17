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

import { InkboxAPIError } from "./_http.js";
import type { Message, MessageDetail, ThreadDetail } from "./mail/types.js";
import type { PhoneCall, PhoneCallWithRateLimit, PhoneTranscript } from "./phone/types.js";
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

  constructor(data: _AgentIdentityData, inkbox: Inkbox) {
    this._data        = data;
    this._inkbox      = inkbox;
    this._mailbox     = data.mailbox;
    this._phoneNumber = data.phoneNumber;
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
  iterEmails(options: { pageSize?: number; direction?: "inbound" | "outbound" } = {}): AsyncGenerator<Message> {
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
  async *iterUnreadEmails(options: { pageSize?: number; direction?: "inbound" | "outbound" } = {}): AsyncGenerator<Message> {
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
      mailbox:     this._mailbox,
      phoneNumber: this._phoneNumber,
    };
  }

  /**
   * Re-fetch this identity from the API and update cached channels.
   *
   * @returns `this` for chaining.
   */
  async refresh(): Promise<AgentIdentity> {
    const data        = await this._inkbox._idsResource.get(this.agentHandle);
    this._data        = data;
    this._mailbox     = data.mailbox;
    this._phoneNumber = data.phoneNumber;
    return this;
  }

  /** Soft-delete this identity (unlinks channels without deleting them). */
  async delete(): Promise<void> {
    await this._inkbox._idsResource.delete(this.agentHandle);
  }

  // ------------------------------------------------------------------
  // Internal guards
  // ------------------------------------------------------------------

  private _requireMailbox(): void {
    if (!this._mailbox) {
      throw new InkboxAPIError(
        0,
        `Identity '${this.agentHandle}' has no mailbox assigned. Call identity.createMailbox() or identity.assignMailbox() first.`,
      );
    }
  }

  private _requirePhone(): void {
    if (!this._phoneNumber) {
      throw new InkboxAPIError(
        0,
        `Identity '${this.agentHandle}' has no phone number assigned. Call identity.provisionPhoneNumber() or identity.assignPhoneNumber() first.`,
      );
    }
  }
}
