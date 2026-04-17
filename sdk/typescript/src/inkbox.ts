/**
 * inkbox/src/inkbox.ts
 *
 * Inkbox — org-level entry point for all Inkbox APIs.
 */

import { CookieJar, HttpTransport, InkboxAPIError } from "./_http.js";
import type { RawWhoamiResponse, WhoamiResponse } from "./whoami/types.js";
import { parseWhoamiResponse } from "./whoami/types.js";
import { MailboxesResource } from "./mail/resources/mailboxes.js";
import { MessagesResource } from "./mail/resources/messages.js";
import { ThreadsResource } from "./mail/resources/threads.js";
import { SigningKeysResource } from "./signing_keys.js";
import type { SigningKey } from "./signing_keys.js";
import { PhoneNumbersResource } from "./phone/resources/numbers.js";
import { CallsResource } from "./phone/resources/calls.js";
import { TextsResource } from "./phone/resources/texts.js";
import { TranscriptsResource } from "./phone/resources/transcripts.js";
import { IdentitiesResource } from "./identities/resources/identities.js";
import { VaultResource } from "./vault/resources/vault.js";
import { WalletsResource } from "./wallet/resources/wallets.js";
import { AgentIdentity } from "./agent_identity.js";
import type { AgentIdentitySummary, CreateIdentityOptions } from "./identities/types.js";
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

export interface SignupOptions {
  /** Override the API base URL (useful for self-hosting or testing). */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30 000. */
  timeoutMs?: number;
}

export interface InkboxOptions {
  /** Your Inkbox API key (sent as `X-API-Key`). */
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
 * // Provision a phone number for the identity
 * const phone = await identity.provisionPhoneNumber({ type: "toll_free" });
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
  readonly _texts: TextsResource;
  readonly _transcripts: TranscriptsResource;
  readonly _idsResource: IdentitiesResource;
  readonly _vaultResource: VaultResource;
  readonly _wallets: WalletsResource;
  readonly _rootApiHttp: HttpTransport;
  /** @internal */
  _vaultUnlockPromise: Promise<unknown> | null = null;

  constructor(options: InkboxOptions) {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
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
    const cookieJar = new CookieJar();

    const mailHttp     = new HttpTransport(options.apiKey, `${apiRoot}/mail`, ms, cookieJar);
    const phoneHttp    = new HttpTransport(options.apiKey, `${apiRoot}/phone`, ms, cookieJar);
    const idsHttp      = new HttpTransport(options.apiKey, `${apiRoot}/identities`, ms, cookieJar);
    const vaultHttp    = new HttpTransport(options.apiKey, `${apiRoot}/vault`, ms, cookieJar);
    const walletHttp   = new HttpTransport(options.apiKey, `${apiRoot}/wallets`, ms, cookieJar);
    const rootApiHttp  = new HttpTransport(options.apiKey, `${baseUrl.replace(/\/$/, "")}/api`, ms, cookieJar);
    const apiHttp      = new HttpTransport(options.apiKey, apiRoot, ms, cookieJar);

    this._mailboxes   = new MailboxesResource(mailHttp);
    this._messages    = new MessagesResource(mailHttp);
    this._threads     = new ThreadsResource(mailHttp);
    this._signingKeys = new SigningKeysResource(apiHttp);

    this._numbers     = new PhoneNumbersResource(phoneHttp);
    this._calls       = new CallsResource(phoneHttp);
    this._texts       = new TextsResource(phoneHttp);
    this._transcripts = new TranscriptsResource(phoneHttp);

    this._idsResource = new IdentitiesResource(idsHttp);
    this._wallets = new WalletsResource(walletHttp);

    this._rootApiHttp = rootApiHttp;
    this._vaultResource = new VaultResource(vaultHttp, rootApiHttp);

    if (options.vaultKey !== undefined) {
      this._vaultUnlockPromise = this._vaultResource.unlock(options.vaultKey);
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

  /** Org-level mailbox operations (list, get, create, update, delete). */
  get mailboxes(): MailboxesResource { return this._mailboxes; }

  /** Message operations (list, get, send, delete, star/unstar). */
  get messages(): MessagesResource { return this._messages; }

  /** Thread operations (list, get, delete). */
  get threads(): ThreadsResource { return this._threads; }

  /** Org-level phone number operations (list, get, provision, release). */
  get phoneNumbers(): PhoneNumbersResource { return this._numbers; }

  /** Text message operations (list, get, search, conversations). */
  get texts(): TextsResource { return this._texts; }

  /** Encrypted vault (info, unlock, secrets). */
  get vault(): VaultResource { return this._vaultResource; }

  /** Org-level wallet operations (create, list, balance, sends, history, pay-request). */
  get wallets(): WalletsResource { return this._wallets; }

  // ------------------------------------------------------------------
  // Org-level operations
  // ------------------------------------------------------------------

  /**
   * Create a new agent identity.
   *
   * @param agentHandle - Unique handle for this identity (e.g. `"sales-bot"`).
   * @param options.createMailbox - Whether to create and link a mailbox in the
   *   same request. This is also implied when `displayName` or `emailLocalPart`
   *   is provided.
   * @param options.displayName - Optional human-readable mailbox name.
   * @param options.emailLocalPart - Optional requested mailbox local part.
   * @param options.phoneNumber - Optional phone-number provisioning payload.
   * @param options.wallet - Optional wallet provisioning payload.
   * @param options.vaultSecretIds - Optional vault secret selection to attach
   *   to the new identity.
   * @returns The created {@link AgentIdentity}.
   */
  async createIdentity(
    agentHandle: string,
    options: CreateIdentityOptions = {},
  ): Promise<AgentIdentity> {
    const mailbox =
      options.createMailbox || options.displayName !== undefined || options.emailLocalPart !== undefined
        ? {
            displayName: options.displayName,
            emailLocalPart: options.emailLocalPart,
          }
        : undefined;
    await this._idsResource.create({
      agentHandle,
      mailbox,
      phoneNumber: options.phoneNumber,
      wallet: options.wallet,
      vaultSecretIds: options.vaultSecretIds,
    });
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

    const headers: Record<string, string> = { Accept: "application/json" };
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
