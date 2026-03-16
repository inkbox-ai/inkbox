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
import type { Message, ThreadDetail } from "./mail/types.js";
import type { PhoneCall, PhoneCallWithRateLimit, PhoneTranscript } from "./phone/types.js";
import type { _AgentIdentityData, IdentityMailbox, IdentityPhoneNumber } from "./identities/types.js";
import type { Inkbox } from "./inkbox.js";
export declare class AgentIdentity {
    private _data;
    private readonly _inkbox;
    private _mailbox;
    private _phoneNumber;
    constructor(data: _AgentIdentityData, inkbox: Inkbox);
    get agentHandle(): string;
    get id(): string;
    get status(): string;
    /** The mailbox currently assigned to this identity, or `null` if none. */
    get mailbox(): IdentityMailbox | null;
    /** The phone number currently assigned to this identity, or `null` if none. */
    get phoneNumber(): IdentityPhoneNumber | null;
    /**
     * Create a new mailbox and link it to this identity.
     *
     * @param options.displayName - Optional human-readable sender name.
     * @returns The newly created and linked {@link IdentityMailbox}.
     */
    createMailbox(options?: {
        displayName?: string;
    }): Promise<IdentityMailbox>;
    /**
     * Link an existing mailbox to this identity.
     *
     * @param mailboxId - UUID of the mailbox to link. Obtain via
     *   `inkbox.mailboxes.list()` or `inkbox.mailboxes.get()`.
     * @returns The linked {@link IdentityMailbox}.
     */
    assignMailbox(mailboxId: string): Promise<IdentityMailbox>;
    /**
     * Unlink this identity's mailbox (does not delete the mailbox).
     */
    unlinkMailbox(): Promise<void>;
    /**
     * Provision a new phone number and link it to this identity.
     *
     * @param options.type - `"toll_free"` (default) or `"local"`.
     * @param options.state - US state abbreviation (e.g. `"NY"`), valid for local numbers only.
     * @returns The newly provisioned and linked {@link IdentityPhoneNumber}.
     */
    provisionPhoneNumber(options?: {
        type?: string;
        state?: string;
    }): Promise<IdentityPhoneNumber>;
    /**
     * Link an existing phone number to this identity.
     *
     * @param phoneNumberId - UUID of the phone number to link. Obtain via
     *   `inkbox.phoneNumbers.list()` or `inkbox.phoneNumbers.get()`.
     * @returns The linked {@link IdentityPhoneNumber}.
     */
    assignPhoneNumber(phoneNumberId: string): Promise<IdentityPhoneNumber>;
    /**
     * Unlink this identity's phone number (does not release the number).
     */
    unlinkPhoneNumber(): Promise<void>;
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
    sendEmail(options: {
        to: string[];
        subject: string;
        bodyText?: string;
        bodyHtml?: string;
        cc?: string[];
        bcc?: string[];
        inReplyToMessageId?: string;
        attachments?: Array<{
            filename: string;
            contentType: string;
            contentBase64: string;
        }>;
    }): Promise<Message>;
    /**
     * Iterate over emails in this identity's inbox, newest first.
     *
     * Pagination is handled automatically.
     *
     * @param options.pageSize - Messages fetched per API call (1–100). Defaults to 50.
     * @param options.direction - Filter by `"inbound"` or `"outbound"`.
     */
    iterEmails(options?: {
        pageSize?: number;
        direction?: "inbound" | "outbound";
    }): AsyncGenerator<Message>;
    /**
     * Iterate over unread emails in this identity's inbox, newest first.
     *
     * Fetches all messages and filters client-side. Pagination is handled automatically.
     *
     * @param options.pageSize - Messages fetched per API call (1–100). Defaults to 50.
     * @param options.direction - Filter by `"inbound"` or `"outbound"`.
     */
    iterUnreadEmails(options?: {
        pageSize?: number;
        direction?: "inbound" | "outbound";
    }): AsyncGenerator<Message>;
    /**
     * Mark a list of messages as read.
     *
     * @param messageIds - IDs of the messages to mark as read.
     */
    markEmailsRead(messageIds: string[]): Promise<void>;
    /**
     * Get a thread with all its messages inlined (oldest-first).
     *
     * @param threadId - UUID of the thread to fetch. Obtain via `msg.threadId`
     *   on any {@link Message}.
     */
    getThread(threadId: string): Promise<ThreadDetail>;
    /**
     * Place an outbound call from this identity's phone number.
     *
     * @param options.toNumber - E.164 destination number.
     * @param options.clientWebsocketUrl - WebSocket URL (wss://) for audio bridging.
     * @param options.webhookUrl - Custom webhook URL for call lifecycle events.
     */
    placeCall(options: {
        toNumber: string;
        clientWebsocketUrl?: string;
        webhookUrl?: string;
    }): Promise<PhoneCallWithRateLimit>;
    /**
     * List calls made to/from this identity's phone number.
     *
     * @param options.limit - Maximum number of results. Defaults to 50.
     * @param options.offset - Pagination offset. Defaults to 0.
     */
    listCalls(options?: {
        limit?: number;
        offset?: number;
    }): Promise<PhoneCall[]>;
    /**
     * List transcript segments for a specific call.
     *
     * @param callId - ID of the call to fetch transcripts for.
     */
    listTranscripts(callId: string): Promise<PhoneTranscript[]>;
    /**
     * Update this identity's handle or status.
     *
     * @param options.newHandle - New agent handle.
     * @param options.status - New lifecycle status: `"active"` or `"paused"`.
     */
    update(options: {
        newHandle?: string;
        status?: string;
    }): Promise<void>;
    /**
     * Re-fetch this identity from the API and update cached channels.
     *
     * @returns `this` for chaining.
     */
    refresh(): Promise<AgentIdentity>;
    /** Soft-delete this identity (unlinks channels without deleting them). */
    delete(): Promise<void>;
    private _requireMailbox;
    private _requirePhone;
}
//# sourceMappingURL=agent_identity.d.ts.map