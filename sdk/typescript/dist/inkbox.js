/**
 * inkbox/src/inkbox.ts
 *
 * Inkbox — org-level entry point for all Inkbox APIs.
 */
import { HttpTransport } from "./_http.js";
import { MailboxesResource } from "./mail/resources/mailboxes.js";
import { MessagesResource } from "./mail/resources/messages.js";
import { ThreadsResource } from "./mail/resources/threads.js";
import { SigningKeysResource } from "./signing_keys.js";
import { PhoneNumbersResource } from "./phone/resources/numbers.js";
import { CallsResource } from "./phone/resources/calls.js";
import { TranscriptsResource } from "./phone/resources/transcripts.js";
import { IdentitiesResource } from "./identities/resources/identities.js";
import { AgentIdentity } from "./agent_identity.js";
const DEFAULT_BASE_URL = "https://api.inkbox.ai";
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
export class Inkbox {
    _mailboxes;
    _messages;
    _threads;
    _signingKeys;
    _numbers;
    _calls;
    _transcripts;
    _idsResource;
    constructor(options) {
        const apiRoot = `${(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/api/v1`;
        const ms = options.timeoutMs ?? 30_000;
        const mailHttp = new HttpTransport(options.apiKey, `${apiRoot}/mail`, ms);
        const phoneHttp = new HttpTransport(options.apiKey, `${apiRoot}/phone`, ms);
        const idsHttp = new HttpTransport(options.apiKey, `${apiRoot}/identities`, ms);
        const apiHttp = new HttpTransport(options.apiKey, apiRoot, ms);
        this._mailboxes = new MailboxesResource(mailHttp);
        this._messages = new MessagesResource(mailHttp);
        this._threads = new ThreadsResource(mailHttp);
        this._signingKeys = new SigningKeysResource(apiHttp);
        this._numbers = new PhoneNumbersResource(phoneHttp);
        this._calls = new CallsResource(phoneHttp);
        this._transcripts = new TranscriptsResource(phoneHttp);
        this._idsResource = new IdentitiesResource(idsHttp);
    }
    // ------------------------------------------------------------------
    // Public resource accessors
    // ------------------------------------------------------------------
    /** Org-level mailbox operations (list, get, create, update, delete). */
    get mailboxes() { return this._mailboxes; }
    /** Org-level phone number operations (list, get, provision, release). */
    get phoneNumbers() { return this._numbers; }
    // ------------------------------------------------------------------
    // Org-level operations
    // ------------------------------------------------------------------
    /**
     * Create a new agent identity.
     *
     * @param agentHandle - Unique handle for this identity (e.g. `"sales-bot"`).
     * @returns The created {@link AgentIdentity}.
     */
    async createIdentity(agentHandle) {
        await this._idsResource.create({ agentHandle });
        // POST /identities returns summary (no channel fields); fetch detail so
        // AgentIdentity has a fully-populated _AgentIdentityData.
        const data = await this._idsResource.get(agentHandle);
        return new AgentIdentity(data, this);
    }
    /**
     * Get an existing agent identity by handle.
     *
     * @param agentHandle - Handle of the identity to fetch.
     * @returns The {@link AgentIdentity}.
     */
    async getIdentity(agentHandle) {
        return new AgentIdentity(await this._idsResource.get(agentHandle), this);
    }
    /**
     * List all agent identities for your organisation.
     *
     * @returns Array of {@link AgentIdentitySummary}.
     */
    async listIdentities() {
        return this._idsResource.list();
    }
    /**
     * Create or rotate the org-level webhook signing key.
     *
     * The plaintext key is returned once — save it immediately.
     *
     * @returns The new {@link SigningKey}.
     */
    async createSigningKey() {
        return this._signingKeys.createOrRotate();
    }
}
//# sourceMappingURL=inkbox.js.map