/**
 * Webhook subscriptions — fan-out per (owner, url, event_types).
 *
 * Replaces the legacy per-resource `webhook_url` columns on mailboxes
 * and phone numbers. Use this resource to attach HTTPS receivers to
 * mail (`message.*`), phone-text (`text.*`), iMessage (`imessage.*`), or
 * post-call lifecycle (`call.ended`) events. Mail and text subscriptions
 * are owned by the mailbox / phone number; iMessage and call-lifecycle
 * subscriptions are owned by the agent identity, since shared iMessage
 * pool numbers are not org resources and a call is only ever owned by its
 * identity. An identity may hold an iMessage sub and a call-lifecycle sub,
 * but a single subscription carries only one channel. Incoming-call
 * webhooks (`phone.incoming_call`) are still set on the phone-number
 * resource itself — that channel is a synchronous control-plane
 * callback whose response body drives call routing, so fan-out is not
 * meaningful.
 */

import { HttpTransport } from "../_http.js";

const PATH = "/webhooks/subscriptions";

/** Lifecycle status of a subscription row. Callers only ever see `"active"`; deleted subscriptions are not returned by `list` / `get`. */
export type WebhookSubscriptionStatus = "active" | "deleted";

/** One context class's mode config: last `count` items (1..50) or last `hours` hours (1..168). */
export type WebhookContextClassConfig =
  | { mode: "count"; count: number }
  | { mode: "window"; hours: number };

/**
 * Per-subscription conversation-context config, keyed by class. Omit a class
 * to leave it unconfigured; the server echoes unconfigured classes back as
 * explicit `null`, so a round-tripped value may carry `null` per class —
 * truthy-check a class (`if (cfg.texts)`), don't test for `undefined`.
 */
export interface WebhookContextConfig {
  email?: WebhookContextClassConfig | null;
  texts?: WebhookContextClassConfig | null;
  calls?: WebhookContextClassConfig | null;
}

export interface WebhookSubscription {
  id: string;
  /** `"org_..."` token; not a UUID. */
  organizationId: string;
  /** Owning mailbox. Exactly one of `mailboxId` / `phoneNumberId` / `agentIdentityId` is non-null. */
  mailboxId: string | null;
  /** Owning phone number. Exactly one of `mailboxId` / `phoneNumberId` / `agentIdentityId` is non-null. */
  phoneNumberId: string | null;
  /** Owning agent identity, for identity-owned iMessage subscriptions. */
  agentIdentityId: string | null;
  /**
   * Resolved owning agent identity for every subscription regardless of
   * channel — mail/phone subs resolve it server-side through the mailbox /
   * phone number, while iMessage subs carry it directly. `null` on servers
   * that predate the field.
   */
  ownerIdentityId: string | null;
  url: string;
  /** Wire event-type strings (e.g. `"message.received"`, `"text.sent"`). Not narrowed to a literal union — the catalog is the source of truth. */
  eventTypes: string[];
  status: WebhookSubscriptionStatus;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Per-class conversation context config, or `null` if none (and on servers
   * that predate the field). Unconfigured classes may echo as explicit `null`.
   */
  contextConfig: WebhookContextConfig | null;
}

/**
 * The response from creating a webhook subscription.
 *
 * Extends {@link WebhookSubscription} with a one-time `signingKey`. It is
 * populated **only** on the request that first mints the owning identity's
 * signing key (returned once — store it securely); on every other create it
 * is `null`. List/get/update never return it.
 */
export interface WebhookSubscriptionCreateResponse extends WebhookSubscription {
  signingKey: string | null;
}

export interface RawWebhookSubscription {
  id: string;
  organization_id: string;
  mailbox_id: string | null;
  phone_number_id: string | null;
  agent_identity_id?: string | null;
  owner_identity_id?: string | null;
  url: string;
  event_types: string[];
  status: WebhookSubscriptionStatus;
  created_at: string;
  updated_at: string;
  context_config?: WebhookContextConfig | null;
}

export interface RawWebhookSubscriptionCreateResponse extends RawWebhookSubscription {
  signing_key?: string | null;
}

interface RawListWebhookSubscriptionsResponse {
  subscriptions: RawWebhookSubscription[];
}

export function parseWebhookSubscription(
  r: RawWebhookSubscription,
): WebhookSubscription {
  return {
    id: r.id,
    organizationId: r.organization_id,
    mailboxId: r.mailbox_id,
    phoneNumberId: r.phone_number_id,
    agentIdentityId: r.agent_identity_id ?? null,
    ownerIdentityId: r.owner_identity_id ?? null,
    url: r.url,
    eventTypes: r.event_types,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    contextConfig: r.context_config ?? null,
  };
}

export function parseWebhookSubscriptionCreateResponse(
  r: RawWebhookSubscriptionCreateResponse,
): WebhookSubscriptionCreateResponse {
  return {
    ...parseWebhookSubscription(r),
    signingKey: r.signing_key ?? null,
  };
}

const INCOMING_CALL = "phone.incoming_call";

function assertUrlNotNull(url: unknown): void {
  if (url === null) {
    throw new Error(
      "url must not be null; pass a string, or omit the field to leave it unchanged",
    );
  }
}

function assertEventTypesNotNull(eventTypes: unknown): void {
  if (eventTypes === null) {
    throw new Error(
      "eventTypes must not be null; pass a non-empty array, or omit the field to leave it unchanged",
    );
  }
}

function assertEventTypesNonEmptyDistinct(eventTypes: string[]): void {
  if (eventTypes.length === 0) {
    throw new Error("eventTypes must be a non-empty list");
  }
  const seen = new Set<string>();
  for (const e of eventTypes) {
    if (seen.has(e)) {
      throw new Error(`eventTypes contains duplicate value: '${e}'`);
    }
    seen.add(e);
  }
}

function assertNoIncomingCall(eventTypes: string[]): void {
  if (eventTypes.includes(INCOMING_CALL)) {
    throw new Error(
      `event_type '${INCOMING_CALL}' is not stored in webhook subscriptions; ` +
      "set it on the phone number's `incomingCallWebhookUrl` field instead",
    );
  }
}

// Wire event-type prefix → the owning resource whose channel it belongs to.
// An agent identity owns two channels (iMessage + post-call lifecycle), so two
// prefixes map to it; a single subscription may still only carry one channel.
const EVENT_PREFIX_TO_OWNER: Array<[string, string]> = [
  ["message.", "mailbox"],
  ["text.", "phone_number"],
  ["imessage.", "agent_identity"],
  ["call.", "agent_identity"],
];

// Owner resource → the event-type prefixes it may subscribe to.
const OWNER_EVENT_PREFIXES: Record<string, string[]> = {
  mailbox: ["message."],
  phone_number: ["text."],
  agent_identity: ["imessage.", "call."],
};

function assertChannelCoherence(
  owner: string,
  eventTypes: string[],
): void {
  const allowed = OWNER_EVENT_PREFIXES[owner];
  // The first event's prefix fixes the channel; every event must share it so
  // one subscription never straddles two channels (e.g. imessage.* + call.ended).
  let channelPrefix: string | null = null;
  for (const e of eventTypes) {
    const match = EVENT_PREFIX_TO_OWNER.find(([prefix]) => e.startsWith(prefix));
    if (match === undefined) {
      throw new Error(`event_type '${e}' does not belong to any known channel`);
    }
    const [prefix, targetOwner] = match;
    if (!allowed.includes(prefix)) {
      throw new Error(
        `event_type '${e}' does not belong to the ${owner} ` +
        `channel (it belongs to ${targetOwner})`,
      );
    }
    if (channelPrefix === null) {
      channelPrefix = prefix;
    } else if (prefix !== channelPrefix) {
      throw new Error(
        `event_type '${e}' does not belong to the same channel as the ` +
        `other event types in this subscription`,
      );
    }
  }
  // INCOMING_CALL is rejected by assertNoIncomingCall earlier.
}

const CONTEXT_CLASSES = ["email", "texts", "calls"] as const;
const CONTEXT_MAX_COUNT = 50;
const CONTEXT_MAX_WINDOW_HOURS = 168;

function assertValidContextConfig(cfg: unknown): void {
  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
    throw new Error("contextConfig must be an object of class -> mode config");
  }
  for (const [klass, entry] of Object.entries(cfg as Record<string, unknown>)) {
    if (!(CONTEXT_CLASSES as readonly string[]).includes(klass)) {
      throw new Error(
        `contextConfig has unknown class key '${klass}'; allowed: ${CONTEXT_CLASSES.join(", ")}`,
      );
    }
    if (entry === null || entry === undefined) continue;
    assertValidContextEntry(klass, entry);
  }
}

function assertValidContextEntry(klass: string, entry: unknown): void {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`contextConfig['${klass}'] must be a mode config object`);
  }
  const e = entry as Record<string, unknown>;
  if (e.mode === "count") {
    assertContextInt(klass, e, "count", CONTEXT_MAX_COUNT);
  } else if (e.mode === "window") {
    assertContextInt(klass, e, "hours", CONTEXT_MAX_WINDOW_HOURS);
  } else {
    throw new Error(
      `contextConfig['${klass}'].mode must be 'count' or 'window', got ${JSON.stringify(e.mode)}`,
    );
  }
}

function assertContextInt(
  klass: string,
  entry: Record<string, unknown>,
  key: string,
  hi: number,
): void {
  for (const k of Object.keys(entry)) {
    if (k !== "mode" && k !== key) {
      throw new Error(`contextConfig['${klass}'] has unknown key '${k}'`);
    }
  }
  const value = entry[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > hi) {
    throw new Error(`contextConfig['${klass}'].${key} must be an integer in 1..${hi}`);
  }
}

export interface CreateWebhookSubscriptionOptions {
  mailboxId?: string;
  phoneNumberId?: string;
  agentIdentityId?: string;
  url: string;
  eventTypes: string[];
  /** Opt into per-class conversation context (email/texts/calls) on received events. */
  contextConfig?: WebhookContextConfig;
}

export interface UpdateWebhookSubscriptionOptions {
  url?: string;
  eventTypes?: string[];
  /** Tri-state: omit = unchanged, `null` = clear, object = validate and replace. */
  contextConfig?: WebhookContextConfig | null;
}

export interface ListWebhookSubscriptionsOptions {
  mailboxId?: string;
  phoneNumberId?: string;
  agentIdentityId?: string;
  url?: string;
  eventType?: string;
}

export class WebhookSubscriptionsResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * List webhook subscriptions visible to the caller. Filters AND-combine;
   * unmatched filters return an empty list. `mailboxId` / `phoneNumberId`
   * / `agentIdentityId` are mutually exclusive — passing more than one
   * yields a 422. Deleted subscriptions are not returned.
   */
  async list(
    filters: ListWebhookSubscriptionsOptions = {},
  ): Promise<WebhookSubscription[]> {
    const params: Record<string, string> = {};
    if (filters.mailboxId !== undefined) params["mailbox_id"] = filters.mailboxId;
    if (filters.phoneNumberId !== undefined) params["phone_number_id"] = filters.phoneNumberId;
    if (filters.agentIdentityId !== undefined) params["agent_identity_id"] = filters.agentIdentityId;
    if (filters.url !== undefined) params["url"] = filters.url;
    if (filters.eventType !== undefined) params["event_type"] = filters.eventType;
    const data = await this.http.get<RawListWebhookSubscriptionsResponse>(PATH, params);
    return data.subscriptions.map(parseWebhookSubscription);
  }

  /** Fetch a single subscription by id. Returns 404 if the subscription has been deleted or is not visible to the caller. */
  async get(subId: string): Promise<WebhookSubscription> {
    const data = await this.http.get<RawWebhookSubscription>(`${PATH}/${subId}`);
    return parseWebhookSubscription(data);
  }

  /**
   * Create a webhook subscription. Exactly one of `mailboxId` /
   * `phoneNumberId` / `agentIdentityId` is required; `eventTypes` must
   * be a non-empty list of distinct values belonging to the owner's
   * channel (mailbox → `message.*`, phone number → `text.*`, agent
   * identity → `imessage.*` or `call.ended`). One subscription carries a
   * single channel, so an identity sub may not mix `imessage.*` with
   * `call.ended`.
   *
   * Returns a {@link WebhookSubscriptionCreateResponse}. Its `signingKey`
   * is populated **once** when this is the first subscription for an
   * identity that had no signing key yet — store it securely; it is the
   * only time the plaintext secret is shown. Otherwise `signingKey` is
   * `null`.
   */
  async create(
    options: CreateWebhookSubscriptionOptions,
  ): Promise<WebhookSubscriptionCreateResponse> {
    const owners: Record<string, string | undefined | null> = {
      mailbox: options.mailboxId,
      phone_number: options.phoneNumberId,
      agent_identity: options.agentIdentityId,
    };
    const populated = Object.entries(owners)
      .filter(([, value]) => value !== undefined && value !== null);
    if (populated.length !== 1) {
      throw new Error(
        "Exactly one of mailboxId, phoneNumberId, or agentIdentityId must be provided",
      );
    }
    const [owner, ownerId] = populated[0];
    assertUrlNotNull(options.url);
    assertEventTypesNotNull(options.eventTypes);
    assertEventTypesNonEmptyDistinct(options.eventTypes);
    assertNoIncomingCall(options.eventTypes);
    assertChannelCoherence(owner, options.eventTypes);

    const body: Record<string, unknown> = {
      url: options.url,
      event_types: options.eventTypes,
      [`${owner}_id`]: ownerId,
    };
    if (options.contextConfig !== undefined) {
      assertValidContextConfig(options.contextConfig);
      body["context_config"] = options.contextConfig;
    }
    const data = await this.http.post<RawWebhookSubscriptionCreateResponse>(PATH, body);
    return parseWebhookSubscriptionCreateResponse(data);
  }

  /**
   * Update the destination URL and/or event-type list of a subscription.
   * Omitting both is a no-op. `eventTypes`, if supplied, replaces the
   * stored list and must be non-empty and distinct. Owner FKs are not
   * mutable.
   */
  async update(
    subId: string,
    options: UpdateWebhookSubscriptionOptions,
  ): Promise<WebhookSubscription> {
    const body: Record<string, unknown> = {};
    if (options.url !== undefined) {
      assertUrlNotNull(options.url);
      body["url"] = options.url;
    }
    if (options.eventTypes !== undefined) {
      assertEventTypesNotNull(options.eventTypes);
      assertEventTypesNonEmptyDistinct(options.eventTypes);
      assertNoIncomingCall(options.eventTypes);
      body["event_types"] = options.eventTypes;
    }
    if (options.contextConfig !== undefined) {
      if (options.contextConfig === null) {
        body["context_config"] = null;
      } else {
        assertValidContextConfig(options.contextConfig);
        body["context_config"] = options.contextConfig;
      }
    }
    const data = await this.http.patch<RawWebhookSubscription>(
      `${PATH}/${subId}`,
      body,
    );
    return parseWebhookSubscription(data);
  }

  /** Delete a subscription. Subsequent `list` / `get` calls will not return it. */
  async delete(subId: string): Promise<void> {
    await this.http.delete(`${PATH}/${subId}`);
  }
}
