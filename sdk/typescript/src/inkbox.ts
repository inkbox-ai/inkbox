/**
 * inkbox/src/inkbox.ts
 *
 * Inkbox — org-level entry point for all Inkbox APIs.
 */

import { CookieJar, HttpTransport, InkboxAPIError } from "./_http.js";
import { VERSION } from "./version.js";
import { resolveClientSettings } from "./_config.js";
import type { RawWhoamiResponse, WhoamiResponse } from "./whoami/types.js";
import { parseWhoamiResponse } from "./whoami/types.js";
import { MailboxesResource } from "./mail/resources/mailboxes.js";
import { MessagesResource } from "./mail/resources/messages.js";
import { ThreadsResource } from "./mail/resources/threads.js";
import { MailContactRulesResource } from "./mail/resources/contactRules.js";
import { MailIdentityContactRulesResource } from "./mail/resources/identityContactRules.js";
import { DomainsResource } from "./mail/resources/domains.js";
import { SigningKeysResource } from "./signing_keys.js";
import type { SigningKey } from "./signing_keys.js";
import { WebhookSubscriptionsResource } from "./webhooks/subscriptions.js";
import { WebhookDeliveriesResource } from "./webhooks/deliveries.js";
import { IMessagesResource } from "./imessage/resources/imessages.js";
import { IMessageContactRulesResource } from "./imessage/resources/contactRules.js";
import { PhoneNumbersResource } from "./phone/resources/numbers.js";
import { CallsResource } from "./phone/resources/calls.js";
import { TextsResource } from "./phone/resources/texts.js";
import { IncomingCallActionResource } from "./phone/resources/incomingCallAction.js";
import { HostedAgentConfigResource } from "./phone/resources/hostedAgent.js";
import { PhoneContactRulesResource } from "./phone/resources/contactRules.js";
import { PhoneIdentityContactRulesResource } from "./phone/resources/identityContactRules.js";
import { SmsOptInsResource } from "./phone/resources/smsOptIns.js";
import { IdentitiesResource } from "./identities/resources/identities.js";
import { VaultResource } from "./vault/resources/vault.js";
import { ContactsResource } from "./contacts/resources/contacts.js";
import { NotesResource } from "./notes/resources/notes.js";
import { TunnelsResource } from "./tunnels/resources/tunnels.js";
import { ApiKeysResource } from "./api_keys/resources/apiKeys.js";
import { AgentIdentity } from "./agent_identity.js";
import type {
  AgentIdentitySummary,
  CreateIdentityOptions,
  IdentityMailboxCreateOptions,
} from "./identities/types.js";
import type {
  AgentSignupRequest,
  AgentSignupResponse,
  AgentSignupVerifyRequest,
  AgentSignupVerifyResponse,
  AgentSignupResendResponse,
  AgentSignupStatusResponse,
  RawAgentSignupResponse,
  RawAgentSignupVerifyResponse,
  RawAgentSignupResendResponse,
  RawAgentSignupStatusResponse,
} from "./agent_signup/types.js";
import {
  agentSignupRequestToWire,
  agentSignupVerifyRequestToWire,
  parseAgentSignupResponse,
  parseAgentSignupVerifyResponse,
  parseAgentSignupResendResponse,
  parseAgentSignupStatusResponse,
} from "./agent_signup/types.js";

const DEFAULT_BASE_URL = "https://inkbox.ai";

/**
 * `User-Agent` announcing the SDK (e.g. `inkbox-typescript/0.4.17`); an
 * optional caller token goes first (`inkbox-cli/1.2.3 inkbox-typescript/...`).
 */
function sdkUserAgent(prefix?: string): string {
  const base = `inkbox-typescript/${VERSION}`;
  return prefix ? `${prefix} ${base}` : base;
}

export interface SignupOptions {
  /** Override the API base URL (useful for self-hosting or testing). */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30 000. */
  timeoutMs?: number;
}

export interface InkboxOptions {
  /**
   * Your Inkbox API key (sent as `X-API-Key`). Falls back to the
   * `INKBOX_API_KEY` env var, then `~/.inkbox/config`.
   */
  apiKey?: string;
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
  /**
   * Optional token prepended to the `User-Agent` header (e.g.
   * `"inkbox-cli/1.2.3"`) so a downstream tool identifies itself ahead of
   * the SDK's own token.
   */
  userAgentPrefix?: string;
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
 * // Provision a phone number for the identity
 * const phone = await identity.provisionPhoneNumber(); // provisions a local number
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
  readonly _mailContactRules: MailContactRulesResource;
  readonly _mailIdentityContactRules: MailIdentityContactRulesResource;
  readonly _domains: DomainsResource;
  readonly _signingKeys: SigningKeysResource;
  readonly _webhookSubscriptions: WebhookSubscriptionsResource;
  readonly _webhookDeliveries: WebhookDeliveriesResource;
  private readonly _webhooks: {
    readonly subscriptions: WebhookSubscriptionsResource;
    readonly deliveries: WebhookDeliveriesResource;
  };
  readonly _numbers: PhoneNumbersResource;
  readonly _calls: CallsResource;
  readonly _texts: TextsResource;
  readonly _imessages: IMessagesResource;
  readonly _imessageContactRules: IMessageContactRulesResource;
  readonly _incomingCallAction: IncomingCallActionResource;
  readonly _hostedAgent: HostedAgentConfigResource;
  readonly _phoneContactRules: PhoneContactRulesResource;
  readonly _phoneIdentityContactRules: PhoneIdentityContactRulesResource;
  readonly _smsOptIns: SmsOptInsResource;
  readonly _idsResource: IdentitiesResource;
  readonly _vaultResource: VaultResource;
  readonly _contacts: ContactsResource;
  readonly _notes: NotesResource;
  readonly _tunnels: TunnelsResource;
  readonly _apiKeys: ApiKeysResource;
  readonly _rootApiHttp: HttpTransport;
  /** @internal — used by the tunnel-agent runtime for data-plane auth. */
  readonly _apiKey: string;
  /** @internal */
  _vaultUnlockPromise: Promise<unknown> | null = null;

  constructor(options: InkboxOptions = {}) {
    const resolved = resolveClientSettings({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      vaultKey: options.vaultKey,
    });
    if (resolved.apiKey === undefined) {
      throw new Error(
        "No API key found. Pass apiKey, set INKBOX_API_KEY, or add " +
          "'api_key = ...' to ~/.inkbox/config.",
      );
    }
    const apiKey = resolved.apiKey;
    const vaultKey = resolved.vaultKey;
    this._apiKey = apiKey;
    const baseUrl = resolved.baseUrl ?? DEFAULT_BASE_URL;
    if (!baseUrl.startsWith("https://")) {
      const parsed = new URL(baseUrl);
      if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
        throw new Error(
          "Only HTTPS base URLs are permitted (HTTP is allowed for " +
          "localhost and 127.0.0.1). " +
          "Received a baseUrl that does not start with 'https://'.",
        );
      }
    }
    const apiRoot = `${baseUrl.replace(/\/$/, "")}/api/v1`;
    const ms = options.timeoutMs ?? 30_000;
    const userAgent = sdkUserAgent(options.userAgentPrefix);
    const cookieJar = new CookieJar();

    const mailHttp     = new HttpTransport(apiKey, `${apiRoot}/mail`, ms, cookieJar, userAgent);
    const phoneHttp    = new HttpTransport(apiKey, `${apiRoot}/phone`, ms, cookieJar, userAgent);
    const imessageHttp = new HttpTransport(apiKey, `${apiRoot}/imessage`, ms, cookieJar, userAgent);
    const idsHttp      = new HttpTransport(apiKey, `${apiRoot}/identities`, ms, cookieJar, userAgent);
    const vaultHttp    = new HttpTransport(apiKey, `${apiRoot}/vault`, ms, cookieJar, userAgent);
    const domainsHttp  = new HttpTransport(apiKey, `${apiRoot}/domains`, ms, cookieJar, userAgent);
    const rootApiHttp  = new HttpTransport(apiKey, `${baseUrl.replace(/\/$/, "")}/api`, ms, cookieJar, userAgent);
    const apiHttp      = new HttpTransport(apiKey, apiRoot, ms, cookieJar, userAgent);

    this._mailboxes        = new MailboxesResource(mailHttp);
    this._messages         = new MessagesResource(mailHttp);
    this._threads          = new ThreadsResource(mailHttp);
    this._mailContactRules = new MailContactRulesResource(mailHttp);
    this._domains          = new DomainsResource(domainsHttp);
    // Identity-keyed contact rules ride the api-root transport (base
    // /api/v1) so they reach both /identities/{handle}/...-contact-rules
    // and the org-wide /mail|/phone/contact-rules with full paths.
    this._mailIdentityContactRules = new MailIdentityContactRulesResource(apiHttp);
    this._phoneIdentityContactRules = new PhoneIdentityContactRulesResource(apiHttp);
    this._signingKeys      = new SigningKeysResource(apiHttp);
    this._webhookSubscriptions = new WebhookSubscriptionsResource(apiHttp);
    this._webhookDeliveries = new WebhookDeliveriesResource(apiHttp);
    this._webhooks = Object.freeze({
      subscriptions: this._webhookSubscriptions,
      deliveries: this._webhookDeliveries,
    });

    this._numbers          = new PhoneNumbersResource(phoneHttp);
    this._calls            = new CallsResource(phoneHttp);
    this._texts            = new TextsResource(phoneHttp);
    this._incomingCallAction = new IncomingCallActionResource(phoneHttp);
    this._hostedAgent       = new HostedAgentConfigResource(phoneHttp);
    this._phoneContactRules = new PhoneContactRulesResource(phoneHttp);
    this._smsOptIns         = new SmsOptInsResource(phoneHttp);

    this._imessages            = new IMessagesResource(imessageHttp);
    this._imessageContactRules = new IMessageContactRulesResource(imessageHttp);

    this._idsResource = new IdentitiesResource(idsHttp);

    this._contacts = new ContactsResource(apiHttp);
    this._notes = new NotesResource(apiHttp);
    this._tunnels = new TunnelsResource(apiHttp);
    this._apiKeys = new ApiKeysResource(apiHttp);

    this._rootApiHttp = rootApiHttp;
    this._vaultResource = new VaultResource(vaultHttp, rootApiHttp);

    if (vaultKey !== undefined) {
      this._vaultUnlockPromise = this._vaultResource.unlock(vaultKey);
    }
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  /**
   * Wait for any constructor-initiated async work (e.g. vault unlock) to
   * complete. Returns `this` for chaining.
   *
   * If `vaultKey` was provided in the constructor options, this awaits the
   * unlock and throws if it failed. If no async work was started, this is
   * a no-op.
   *
   * @example
   * ```ts
   * const inkbox = await new Inkbox({
   *   apiKey: process.env.INKBOX_API_KEY!,
   *   vaultKey: process.env.INKBOX_VAULT_KEY!,
   * }).ready();
   * ```
   */
  async ready(): Promise<Inkbox> {
    if (this._vaultUnlockPromise) {
      await this._vaultUnlockPromise;
    }
    return this;
  }

  // ------------------------------------------------------------------
  // Public resource accessors
  // ------------------------------------------------------------------

  /** Org-level mailbox operations (list, get, update, search). Mailboxes are provisioned by `createIdentity` and removed by `identity.delete()` (cascade). */
  get mailboxes(): MailboxesResource { return this._mailboxes; }

  /** Message operations (list, get, send, delete, star/unstar). */
  get messages(): MessagesResource { return this._messages; }

  /** Thread operations (list, get, delete). */
  get threads(): ThreadsResource { return this._threads; }

  /** Org-level phone number operations (list, get, provision, release). */
  get phoneNumbers(): PhoneNumbersResource { return this._numbers; }

  /** Call operations (list, get, transcripts, place). */
  get calls(): CallsResource { return this._calls; }

  /** Text message operations (list, get, search, conversations). */
  get texts(): TextsResource { return this._texts; }

  /** iMessage operations (send, list, conversations, reactions). */
  get imessages(): IMessagesResource { return this._imessages; }

  /** iMessage per-identity allow/block rules (+ org-wide list). */
  get imessageContactRules(): IMessageContactRulesResource { return this._imessageContactRules; }

  /** Incoming-call routing config (get / set), keyed by agent identity. */
  get incomingCallAction(): IncomingCallActionResource { return this._incomingCallAction; }

  /** Hosted call agent config (getConfig / setConfig), keyed by agent identity. */
  get hostedAgent(): HostedAgentConfigResource { return this._hostedAgent; }

  /** Encrypted vault (info, unlock, secrets). */
  get vault(): VaultResource { return this._vaultResource; }

  /** Org-wide contacts (list, get, create, update, delete, lookup, access, vCards). */
  get contacts(): ContactsResource { return this._contacts; }

  /** Org-scoped notes with per-identity access grants. */
  get notes(): NotesResource { return this._notes; }

  /**
   * Mail per-mailbox allow/block rules (+ org-wide list).
   *
   * @deprecated Contact rules are now keyed by agent identity — use
   *   {@link mailIdentityContactRules} (or `identity.*MailContactRule(...)`).
   */
  get mailContactRules(): MailContactRulesResource { return this._mailContactRules; }

  /**
   * Phone per-number allow/block rules (+ org-wide list).
   *
   * @deprecated Contact rules are now keyed by agent identity — use
   *   {@link phoneIdentityContactRules} (or `identity.*PhoneContactRule(...)`).
   */
  get phoneContactRules(): PhoneContactRulesResource { return this._phoneContactRules; }

  /** Mail per-identity allow/block rules (+ org-wide list), keyed by `agentHandle`. */
  get mailIdentityContactRules(): MailIdentityContactRulesResource { return this._mailIdentityContactRules; }

  /** Phone per-identity allow/block rules (+ org-wide list), keyed by `agentHandle`. */
  get phoneIdentityContactRules(): PhoneIdentityContactRulesResource { return this._phoneIdentityContactRules; }

  /**
   * SMS opt-in / opt-out registry (per-(org, receiver) consent).
   * `optIn` / `optOut` writes require the org to be on its own
   * active, customer-managed 10DLC campaign.
   */
  get smsOptIns(): SmsOptInsResource { return this._smsOptIns; }

  /** Custom sending domains (list, set org default). */
  get domains(): DomainsResource { return this._domains; }

  /** Tunnels (list, get, update, signCsr). Tunnels are provisioned by `createIdentity` and removed by `identity.delete()` (cascade). */
  get tunnels(): TunnelsResource { return this._tunnels; }

  /** Org-level API key creation. Admin-scoped API keys can mint identity-scoped keys. */
  get apiKeys(): ApiKeysResource { return this._apiKeys; }

  /**
   * Per-identity webhook signing keys. Use `createOrRotate(agentHandle)` /
   * `getStatus(agentHandle)` (or `identity.createSigningKey()` /
   * `identity.getSigningKeyStatus()`). Calling either with no handle hits the
   * deprecated org-level endpoint.
   */
  get signingKeys(): SigningKeysResource { return this._signingKeys; }

  /**
   * Webhook subscription management and delivery log. Use
   * `inkbox.webhooks.subscriptions` to attach HTTPS receivers to mail
   * (`message.*`), phone-text (`text.*`), or iMessage (`imessage.*`)
   * events, and `inkbox.webhooks.deliveries` to inspect logged delivery
   * attempts and replay missed ones. Incoming-call webhooks still live
   * on the phone-number resource (`incomingCallWebhookUrl`) because the
   * response body controls call routing.
   */
  get webhooks(): {
    readonly subscriptions: WebhookSubscriptionsResource;
    readonly deliveries: WebhookDeliveriesResource;
  } {
    return this._webhooks;
  }

  // ------------------------------------------------------------------
  // Org-level operations
  // ------------------------------------------------------------------

  /**
   * Create a new agent identity. Atomically provisions the linked
   * mailbox and tunnel as part of the same request.
   *
   * @param agentHandle - Unique handle for this identity. Globally unique
   *   across all orgs (the handle shares its namespace with tunnel names).
   * @param options.displayName - Identity-level human-readable name.
   *   Defaults server-side to `agentHandle`.
   * @param options.description - Free-form org-internal description.
   *   Never surfaces in outbound mail. Omit to leave null.
   * @param options.imessageEnabled - Whether this identity can be reached
   *   over the shared iMessage service. Defaults server-side to `false`;
   *   pass `true` to opt in.
   * @param options.emailLocalPart - Optional requested mailbox local part.
   *   On the platform domain the server forces it to the handle; only
   *   meaningful on a custom sending domain.
   * @param options.sendingDomain - Optional sending-domain selector (bare
   *   domain name). Omit to inherit the org default; pass `null` to force
   *   the platform default; pass a verified custom-domain name to bind.
   * @param options.tunnel - Optional nested tunnel spec (tlsMode only).
   *   Defaults to edge TLS.
   * @param options.phoneNumber - Optional phone-number provisioning payload.
   * @param options.vaultSecretIds - Optional vault secret selection to attach
   *   to the new identity.
   * @returns The created {@link AgentIdentity}, with `mailbox` and `tunnel`
   *   populated from the atomic create response.
   */
  async createIdentity(
    agentHandle: string,
    options: CreateIdentityOptions = {},
  ): Promise<AgentIdentity> {
    const mailbox: IdentityMailboxCreateOptions = {};
    if (options.emailLocalPart !== undefined) mailbox.emailLocalPart = options.emailLocalPart;
    if ("sendingDomain" in options) mailbox.sendingDomain = options.sendingDomain;
    const createArgs: Parameters<typeof this._idsResource.create>[0] = {
      agentHandle,
      mailbox,
      phoneNumber: options.phoneNumber,
      vaultSecretIds: options.vaultSecretIds,
    };
    if (options.displayName !== undefined) createArgs.displayName = options.displayName;
    if (options.description !== undefined) createArgs.description = options.description;
    if (options.imessageEnabled !== undefined) createArgs.imessageEnabled = options.imessageEnabled;
    if (options.tunnel !== undefined) createArgs.tunnel = options.tunnel;
    const data = await this._idsResource.create(createArgs);
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
   * Create or rotate a webhook signing key via the deprecated org-level
   * endpoint.
   *
   * The plaintext key is returned once — save it immediately.
   *
   * @deprecated Signing keys are now per agent identity. Prefer
   *   `identity.createSigningKey()` (or
   *   `inkbox.signingKeys.createOrRotate(agentHandle)`). With an agent-scoped
   *   API key this rotates that key's identity; with an admin key the server
   *   returns 409 (`InkboxAPIError`).
   *
   * @returns The new {@link SigningKey}.
   */
  async createSigningKey(): Promise<SigningKey> {
    return this._signingKeys.createOrRotate();
  }

  /**
   * Return the authenticated caller's identity and auth type.
   *
   * @returns A {@link WhoamiResponse} — either an API-key or JWT variant.
   */
  async whoami(): Promise<WhoamiResponse> {
    const raw = await this._rootApiHttp.get<RawWhoamiResponse>("/whoami");
    return parseWhoamiResponse(raw);
  }

  // ------------------------------------------------------------------
  // Agent signup (static — no instance required)
  // ------------------------------------------------------------------

  /** @internal One-shot fetch for agent-signup endpoints. */
  private static async _signupFetch<T>(
    method: string,
    path: string,
    opts: { apiKey?: string; body?: unknown; baseUrl?: string; timeoutMs?: number },
  ): Promise<T> {
    const base = opts.baseUrl ?? DEFAULT_BASE_URL;
    if (!base.startsWith("https://")) {
      const parsed = new URL(base);
      if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
        throw new Error(
          "Only HTTPS base URLs are permitted (HTTP is allowed for " +
          "localhost and 127.0.0.1).",
        );
      }
    }
    const url = `${base.replace(/\/$/, "")}/api/v1/agent-signup${path}`;
    const ms = opts.timeoutMs ?? 30_000;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": sdkUserAgent(),
    };
    if (opts.apiKey) headers["X-API-Key"] = opts.apiKey;

    let bodyStr: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyStr = JSON.stringify(opts.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);

    let resp: Response;
    try {
      resp = await fetch(url, { method, headers, body: bodyStr, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      let detail: string;
      try {
        const err = (await resp.json()) as { detail?: string };
        detail = err.detail ?? resp.statusText;
      } catch {
        detail = resp.statusText;
      }
      throw new InkboxAPIError(resp.status, detail);
    }

    return resp.json() as Promise<T>;
  }

  /**
   * Register a new agent (public — no API key required).
   *
   * Returns the provisioned email, org, and a one-time API key.
   */
  static async signup(
    request: AgentSignupRequest,
    options?: SignupOptions,
  ): Promise<AgentSignupResponse> {
    const raw = await Inkbox._signupFetch<RawAgentSignupResponse>(
      "POST", "", { body: agentSignupRequestToWire(request), ...options },
    );
    return parseAgentSignupResponse(raw);
  }

  /**
   * Submit a 6-digit verification code to unlock full capabilities.
   */
  static async verifySignup(
    apiKey: string,
    request: AgentSignupVerifyRequest,
    options?: SignupOptions,
  ): Promise<AgentSignupVerifyResponse> {
    const raw = await Inkbox._signupFetch<RawAgentSignupVerifyResponse>(
      "POST", "/verify", { apiKey, body: agentSignupVerifyRequestToWire(request), ...options },
    );
    return parseAgentSignupVerifyResponse(raw);
  }

  /**
   * Resend the verification email (5-minute cooldown).
   */
  static async resendSignupVerification(
    apiKey: string,
    options?: SignupOptions,
  ): Promise<AgentSignupResendResponse> {
    const raw = await Inkbox._signupFetch<RawAgentSignupResendResponse>(
      "POST", "/resend-verification", { apiKey, ...options },
    );
    return parseAgentSignupResendResponse(raw);
  }

  /**
   * Check the current signup claim status and restrictions.
   */
  static async getSignupStatus(
    apiKey: string,
    options?: SignupOptions,
  ): Promise<AgentSignupStatusResponse> {
    const raw = await Inkbox._signupFetch<RawAgentSignupStatusResponse>(
      "GET", "/status", { apiKey, ...options },
    );
    return parseAgentSignupStatusResponse(raw);
  }
}
