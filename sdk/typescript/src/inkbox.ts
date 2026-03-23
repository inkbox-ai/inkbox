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
import type { SigningKey } from "./signing_keys.js";
import { PhoneNumbersResource } from "./phone/resources/numbers.js";
import { CallsResource } from "./phone/resources/calls.js";
import { TranscriptsResource } from "./phone/resources/transcripts.js";
import { IdentitiesResource } from "./identities/resources/identities.js";
import { AuthenticatorAppsResource } from "./authenticator/resources/apps.js";
import { AuthenticatorAccountsResource } from "./authenticator/resources/accounts.js";
import { VaultResource } from "./vault/resources/vault.js";
import { AgentIdentity } from "./agent_identity.js";
import type { AgentIdentitySummary } from "./identities/types.js";

const DEFAULT_BASE_URL = "https://api.inkbox.ai";

export interface InkboxOptions {
  /** Your Inkbox API key (sent as `X-Service-Token`). */
  apiKey: string;
  /** Override the API base URL (useful for self-hosting or testing). */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30 000. */
  timeoutMs?: number;
  /**
   * Optional vault key or recovery code.  When provided, the vault is
   * unlocked automatically at construction so `identity.getCredentials()`
   * is immediately available.
   */
  vaultKey?: string;
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
 *
 * @example With vault credentials:
 * ```ts
 * const inkbox = new Inkbox({
 *   apiKey: process.env.INKBOX_API_KEY!,
 *   vaultKey: "my-Vault-key-01!",
 * });
 * const identity = await inkbox.getIdentity("my-agent");
 * const creds = await identity.getCredentials();
 * for (const login of creds.listLogins()) {
 *   console.log(login.name);
 * }
 * ```
 */
export class Inkbox {
  readonly _mailboxes: MailboxesResource;
  readonly _messages: MessagesResource;
  readonly _threads: ThreadsResource;
  readonly _signingKeys: SigningKeysResource;
  readonly _numbers: PhoneNumbersResource;
  readonly _calls: CallsResource;
  readonly _transcripts: TranscriptsResource;
  readonly _idsResource: IdentitiesResource;
  readonly _authApps: AuthenticatorAppsResource;
  readonly _authAccounts: AuthenticatorAccountsResource;
  readonly _vaultResource: VaultResource;
  /** @internal */
  _vaultUnlockPromise: Promise<unknown> | null = null;

  constructor(options: InkboxOptions) {
    const apiRoot = `${(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/api/v1`;
    const ms = options.timeoutMs ?? 30_000;

    const mailHttp  = new HttpTransport(options.apiKey, `${apiRoot}/mail`, ms);
    const phoneHttp = new HttpTransport(options.apiKey, `${apiRoot}/phone`, ms);
    const idsHttp   = new HttpTransport(options.apiKey, `${apiRoot}/identities`, ms);
    const authHttp  = new HttpTransport(options.apiKey, `${apiRoot}/authenticator`, ms);
    const vaultHttp = new HttpTransport(options.apiKey, `${apiRoot}/vault`, ms);
    const apiHttp   = new HttpTransport(options.apiKey, apiRoot, ms);

    this._mailboxes   = new MailboxesResource(mailHttp);
    this._messages    = new MessagesResource(mailHttp);
    this._threads     = new ThreadsResource(mailHttp);
    this._signingKeys = new SigningKeysResource(apiHttp);

    this._numbers     = new PhoneNumbersResource(phoneHttp);
    this._calls       = new CallsResource(phoneHttp);
    this._transcripts = new TranscriptsResource(phoneHttp);

    this._idsResource = new IdentitiesResource(idsHttp);

    this._authApps     = new AuthenticatorAppsResource(authHttp);
    this._authAccounts = new AuthenticatorAccountsResource(authHttp);

    this._vaultResource = new VaultResource(vaultHttp);

    if (options.vaultKey !== undefined) {
      this._vaultUnlockPromise = this._vaultResource.unlock(options.vaultKey);
    }
  }

  // ------------------------------------------------------------------
  // Public resource accessors
  // ------------------------------------------------------------------

  /** Org-level mailbox operations (list, get, create, update, delete). */
  get mailboxes(): MailboxesResource { return this._mailboxes; }

  /** Org-level phone number operations (list, get, provision, release). */
  get phoneNumbers(): PhoneNumbersResource { return this._numbers; }

  /** Org-level authenticator app operations (list, get, create, delete). */
  get authenticatorApps(): AuthenticatorAppsResource { return this._authApps; }

  /** Encrypted vault (info, unlock, secrets). */
  get vault(): VaultResource { return this._vaultResource; }

  // ------------------------------------------------------------------
  // Org-level operations
  // ------------------------------------------------------------------

  /**
   * Create a new agent identity.
   *
   * @param agentHandle - Unique handle for this identity (e.g. `"sales-bot"`).
   * @returns The created {@link AgentIdentity}.
   */
  async createIdentity(agentHandle: string): Promise<AgentIdentity> {
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
  async getIdentity(agentHandle: string): Promise<AgentIdentity> {
    return new AgentIdentity(await this._idsResource.get(agentHandle), this);
  }

  /**
   * List all agent identities for your organisation.
   *
   * @returns Array of {@link AgentIdentitySummary}.
   */
  async listIdentities(): Promise<AgentIdentitySummary[]> {
    return this._idsResource.list();
  }

  /**
   * Create or rotate the org-level webhook signing key.
   *
   * The plaintext key is returned once — save it immediately.
   *
   * @returns The new {@link SigningKey}.
   */
  async createSigningKey(): Promise<SigningKey> {
    return this._signingKeys.createOrRotate();
  }
}
