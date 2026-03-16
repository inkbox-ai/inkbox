/**
 * inkbox/src/inkbox.ts
 *
 * Inkbox — org-level entry point for all Inkbox APIs.
 */
import { MailboxesResource } from "./mail/resources/mailboxes.js";
import { MessagesResource } from "./mail/resources/messages.js";
import { ThreadsResource } from "./mail/resources/threads.js";
import { SigningKeysResource } from "./signing_keys.js";
import type { SigningKey } from "./signing_keys.js";
import { PhoneNumbersResource } from "./phone/resources/numbers.js";
import { CallsResource } from "./phone/resources/calls.js";
import { TranscriptsResource } from "./phone/resources/transcripts.js";
import { IdentitiesResource } from "./identities/resources/identities.js";
import { AgentIdentity } from "./agent_identity.js";
import type { AgentIdentitySummary } from "./identities/types.js";
export interface InkboxOptions {
    /** Your Inkbox API key (sent as `X-Service-Token`). */
    apiKey: string;
    /** Override the API base URL (useful for self-hosting or testing). */
    baseUrl?: string;
    /** Request timeout in milliseconds. Defaults to 30 000. */
    timeoutMs?: number;
}
/**
 * Org-level entry point for all Inkbox APIs.
 *
 * @example
 * ```ts
 * import { Inkbox } from "@inkbox/sdk";
 *
 * const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
 *
 * // Create an agent identity
 * const identity = await inkbox.createIdentity("support-bot");
 *
 * // Create and link new channels
 * const mailbox = await identity.createMailbox({ displayName: "Support Bot" });
 * const phone   = await identity.provisionPhoneNumber({ type: "toll_free" });
 *
 * // Send email directly from the identity
 * await identity.sendEmail({
 *   to: ["customer@example.com"],
 *   subject: "Your order has shipped",
 *   bodyText: "Tracking number: 1Z999AA10123456784",
 * });
 * ```
 */
export declare class Inkbox {
    readonly _mailboxes: MailboxesResource;
    readonly _messages: MessagesResource;
    readonly _threads: ThreadsResource;
    readonly _signingKeys: SigningKeysResource;
    readonly _numbers: PhoneNumbersResource;
    readonly _calls: CallsResource;
    readonly _transcripts: TranscriptsResource;
    readonly _idsResource: IdentitiesResource;
    constructor(options: InkboxOptions);
    /** Org-level mailbox operations (list, get, create, update, delete). */
    get mailboxes(): MailboxesResource;
    /** Org-level phone number operations (list, get, provision, release). */
    get phoneNumbers(): PhoneNumbersResource;
    /**
     * Create a new agent identity.
     *
     * @param agentHandle - Unique handle for this identity (e.g. `"sales-bot"`).
     * @returns The created {@link AgentIdentity}.
     */
    createIdentity(agentHandle: string): Promise<AgentIdentity>;
    /**
     * Get an existing agent identity by handle.
     *
     * @param agentHandle - Handle of the identity to fetch.
     * @returns The {@link AgentIdentity}.
     */
    getIdentity(agentHandle: string): Promise<AgentIdentity>;
    /**
     * List all agent identities for your organisation.
     *
     * @returns Array of {@link AgentIdentitySummary}.
     */
    listIdentities(): Promise<AgentIdentitySummary[]>;
    /**
     * Create or rotate the org-level webhook signing key.
     *
     * The plaintext key is returned once — save it immediately.
     *
     * @returns The new {@link SigningKey}.
     */
    createSigningKey(): Promise<SigningKey>;
}
//# sourceMappingURL=inkbox.d.ts.map