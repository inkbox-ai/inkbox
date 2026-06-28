/**
 * Webhook delivery log + manual replay.
 *
 * Every outbound webhook attempt is recorded as a delivery row: the
 * signed request body that was sent, the endpoint's HTTP response (or
 * transport error), and timing. Use `list` to inspect what was (or was
 * not) delivered, and `replay` to re-deliver a logged event to its
 * subscription's current URL.
 *
 * Replay reuses the original envelope `eventId`, so it only recovers a
 * *miss*: a compliant endpoint that already processed the original event
 * dedupes the replay away. It does not force reprocessing. Incoming-call
 * deliveries (which carry a `phoneNumberId` and no
 * `webhookSubscriptionId`) are logged but not replayable.
 */

import { HttpTransport } from "../_http.js";

const PATH = "/webhooks/deliveries";

export interface WebhookDelivery {
  id: string;
  /** `"org_..."` token; not a UUID. */
  organizationId: string;
  /** Subscription this delivery targeted; null for incoming-call deliveries. */
  webhookSubscriptionId: string | null;
  /** Phone number for incoming-call deliveries (which have no subscription). */
  phoneNumberId: string | null;
  /** Envelope event id (`evt_...`), or the call id for incoming-call rows. */
  eventId: string;
  eventType: string;
  url: string;
  /** Raw signed request body that was delivered. */
  requestPayload: string;
  /** HTTP status returned by the endpoint; null on transport failure. */
  responseStatus: number | null;
  /** Truncated response body snippet. */
  responseBody: string | null;
  /** Transport error summary, if any. */
  errorDetail: string | null;
  durationMs: number | null;
  /** True if this row was produced by a manual replay. */
  isReplay: boolean;
  createdAt: Date;
}

export interface RawWebhookDelivery {
  id: string;
  organization_id: string;
  webhook_subscription_id: string | null;
  phone_number_id: string | null;
  event_id: string;
  event_type: string;
  url: string;
  request_payload: string;
  response_status: number | null;
  response_body: string | null;
  error_detail: string | null;
  duration_ms: number | null;
  is_replay: boolean;
  created_at: string;
}

interface RawListWebhookDeliveriesResponse {
  deliveries: RawWebhookDelivery[];
}

export function parseWebhookDelivery(r: RawWebhookDelivery): WebhookDelivery {
  return {
    id: r.id,
    organizationId: r.organization_id,
    webhookSubscriptionId: r.webhook_subscription_id,
    phoneNumberId: r.phone_number_id,
    eventId: r.event_id,
    eventType: r.event_type,
    url: r.url,
    requestPayload: r.request_payload,
    responseStatus: r.response_status,
    responseBody: r.response_body,
    errorDetail: r.error_detail,
    durationMs: r.duration_ms,
    isReplay: r.is_replay,
    createdAt: new Date(r.created_at),
  };
}

export interface ListWebhookDeliveriesOptions {
  subscriptionId?: string;
  phoneNumberId?: string;
  eventType?: string;
  /** Filter on a 2xx response: `true` → delivered, `false` → failed or no response. */
  success?: boolean;
  /** Clamped to `[1, 200]` by the API (default 50). */
  limit?: number;
  offset?: number;
}

export class WebhookDeliveriesResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * List logged webhook delivery attempts, newest first. Filters
   * AND-combine. `subscriptionId` scopes to one subscription's
   * deliveries; `phoneNumberId` scopes to a phone number's incoming-call
   * deliveries. `success` filters on a 2xx response.
   */
  async list(
    filters: ListWebhookDeliveriesOptions = {},
  ): Promise<WebhookDelivery[]> {
    const params: Record<string, string> = {};
    if (filters.subscriptionId !== undefined) params["subscription_id"] = filters.subscriptionId;
    if (filters.phoneNumberId !== undefined) params["phone_number_id"] = filters.phoneNumberId;
    if (filters.eventType !== undefined) params["event_type"] = filters.eventType;
    if (filters.success !== undefined) params["success"] = String(filters.success);
    if (filters.limit !== undefined) params["limit"] = String(filters.limit);
    if (filters.offset !== undefined) params["offset"] = String(filters.offset);
    const data = await this.http.get<RawListWebhookDeliveriesResponse>(PATH, params);
    return data.deliveries.map(parseWebhookDelivery);
  }

  /**
   * Re-deliver a logged event to its subscription's current URL. Reuses
   * the original envelope `eventId` (so a compliant endpoint dedupes a
   * replay it already processed) but re-signs with a fresh
   * request-id/timestamp, and records a new delivery row with
   * `isReplay: true` — which is what this returns.
   *
   * Rejects incoming-call deliveries (not replayable, 422) and
   * deliveries whose subscription is no longer active or no longer
   * subscribes to the event type (409).
   */
  async replay(deliveryId: string): Promise<WebhookDelivery> {
    const data = await this.http.post<RawWebhookDelivery>(
      `${PATH}/${deliveryId}/replay`,
    );
    return parseWebhookDelivery(data);
  }
}
