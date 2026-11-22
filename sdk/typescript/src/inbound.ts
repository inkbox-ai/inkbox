/**
 * Inbound sources for hosted agents. Each source has a public URL that
 * accepts requests from an external service, optionally verifies the
 * sender's signature, and delivers each request to the agent as an
 * `inbound.received` event.
 */

import { HttpTransport } from "./_http.js";
import type { InboundWebhookRequest } from "./webhooks/types.js";

export type InboundEventStatus = "pending" | "delivered" | "failed";

/**
 * How the sender signs requests (HMAC); the secret is never returned.
 * `signedContent` is a template of what was signed and must contain `{body}`;
 * it may also use `{timestamp}`, `{header:Name}` and fixed text.
 */
export interface InboundSignature {
  secretEncoding: "text" | "base64";
  header: string;
  format: "whole" | "prefix" | "list";
  formatValue: string | null;
  algorithm: "sha256" | "sha1" | "sha512";
  encoding: "hex" | "base64";
  signedContent: string;
  timestampFrom: "none" | "header" | "list";
  timestampValue: string | null;
  maxAgeSeconds: number | null;
}

/**
 * Signature settings to verify the sender. Omitted fields take the server defaults.
 *
 * `format`: `whole` (the header value is the signature), `prefix` (the value after
 * `formatValue`, for example `sha256=`) or `list` (every item under key `formatValue`
 * in a list such as `t=1,v1=ab` or `v1,ab v1,cd`; any match passes).
 * `secretEncoding: "base64"` decodes the secret first, ignoring a leading `whsec_`.
 * `timestampFrom` is `header` (header `timestampValue`) or `list` (key `timestampValue`
 * in the signature header); `maxAgeSeconds` rejects requests whose timestamp is further from now.
 */
export interface InboundSignatureInput {
  secret: string;
  header: string;
  secretEncoding?: "text" | "base64";
  format?: "whole" | "prefix" | "list";
  formatValue?: string;
  algorithm?: "sha256" | "sha1" | "sha512";
  encoding?: "hex" | "base64";
  signedContent?: string;
  timestampFrom?: "none" | "header" | "list";
  timestampValue?: string;
  maxAgeSeconds?: number;
}

export interface InboundSignatureCheck {
  verified: boolean;
  reason: string | null;
}

interface RawInboundSignature {
  secret_encoding: InboundSignature["secretEncoding"]; header: string; format: InboundSignature["format"];
  format_value?: string | null; algorithm: InboundSignature["algorithm"]; encoding: InboundSignature["encoding"];
  signed_content: string; timestamp_from: InboundSignature["timestampFrom"]; timestamp_value?: string | null;
  max_age_seconds?: number | null;
}

function parseSignature(r: RawInboundSignature): InboundSignature {
  return {
    secretEncoding: r.secret_encoding, header: r.header, format: r.format, formatValue: r.format_value ?? null,
    algorithm: r.algorithm, encoding: r.encoding, signedContent: r.signed_content, timestampFrom: r.timestamp_from,
    timestampValue: r.timestamp_value ?? null, maxAgeSeconds: r.max_age_seconds ?? null,
  };
}

function signatureBody(s: InboundSignatureInput | null | undefined): Record<string, unknown> | null {
  if (!s) return null;
  const body: Record<string, unknown> = {
    secret: s.secret, header: s.header, secret_encoding: s.secretEncoding, format: s.format, format_value: s.formatValue,
    algorithm: s.algorithm, encoding: s.encoding, signed_content: s.signedContent, timestamp_from: s.timestampFrom,
    timestamp_value: s.timestampValue, max_age_seconds: s.maxAgeSeconds,
  };
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

export type InboundHandler =
  | { type: "agent"; instructions?: string | null }
  | { type: "script"; command: string };

export interface InboundSource {
  id: string;
  name: string;
  url: string;
  signature: InboundSignature | null;
  handler: InboundHandler;
  createdAt: string;
  updatedAt: string;
}

export interface InboundEvent {
  id: string;
  sourceId: string;
  receivedAt: string;
  status: InboundEventStatus;
  attempts: number;
  lastError: string | null;
  signatureVerified: boolean;
  contentType: string | null;
  sizeBytes: number;
  /** Only returned by `getEvent`. */
  request: InboundWebhookRequest | null;
}

export interface InboundEventPage {
  events: InboundEvent[];
  nextCursor: string | null;
}

interface RawInboundSource {
  id: string; name: string; url: string; signature?: RawInboundSignature | null;
  handler: InboundHandler; created_at: string; updated_at: string;
}

interface RawInboundEvent {
  id: string; source_id: string; received_at: string; status: InboundEventStatus; attempts: number;
  last_error?: string | null; signature_verified: boolean; content_type?: string | null; size_bytes: number;
  request?: InboundWebhookRequest | null;
}

export function parseInboundSource(r: RawInboundSource): InboundSource {
  return {
    id: r.id, name: r.name, url: r.url, signature: r.signature ? parseSignature(r.signature) : null, handler: r.handler,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function parseInboundEvent(r: RawInboundEvent): InboundEvent {
  return {
    id: r.id, sourceId: r.source_id, receivedAt: r.received_at, status: r.status, attempts: r.attempts,
    lastError: r.last_error ?? null, signatureVerified: r.signature_verified,
    contentType: r.content_type ?? null, sizeBytes: r.size_bytes, request: r.request ?? null,
  };
}

/** Manage an identity's inbound sources and events. The identity must be hosted. */
export class InboundResource {
  constructor(private readonly http: HttpTransport) {}

  private path(handle: string, ...parts: string[]): string {
    return [`/${encodeURIComponent(handle)}/inbound`, ...parts.map(encodeURIComponent)].join("/");
  }

  async createSource(
    handle: string,
    options: { name: string; handler: InboundHandler; signature?: InboundSignatureInput | null },
  ): Promise<InboundSource> {
    const body = { name: options.name, signature: signatureBody(options.signature), handler: options.handler };
    return parseInboundSource(await this.http.post<RawInboundSource>(this.path(handle), body));
  }

  async listSources(handle: string): Promise<InboundSource[]> {
    const data = await this.http.get<{ sources: RawInboundSource[] }>(this.path(handle));
    return data.sources.map(parseInboundSource);
  }

  async getSource(handle: string, sourceId: string): Promise<InboundSource> {
    return parseInboundSource(await this.http.get<RawInboundSource>(this.path(handle, sourceId)));
  }

  /** Omitted fields are unchanged; `signature: null` removes verification. */
  async updateSource(
    handle: string,
    sourceId: string,
    options: { name?: string; handler?: InboundHandler; signature?: InboundSignatureInput | null },
  ): Promise<InboundSource> {
    const body: Record<string, unknown> = { ...options };
    if (options.signature !== undefined) body.signature = signatureBody(options.signature);
    return parseInboundSource(await this.http.patch<RawInboundSource>(this.path(handle, sourceId), body));
  }

  async deleteSource(handle: string, sourceId: string): Promise<void> {
    await this.http.delete(this.path(handle, sourceId));
  }

  /** Issue a new URL; the previous URL stops accepting requests. */
  async rotateSource(handle: string, sourceId: string): Promise<InboundSource> {
    return parseInboundSource(await this.http.post<RawInboundSource>(this.path(handle, sourceId, "rotate")));
  }

  /**
   * Check a sample request against `signature` settings or a saved source's; nothing is stored.
   * Pass exactly one of `signature` or `sourceId`. A `Uint8Array` body is sent unchanged.
   */
  async checkSignature(
    handle: string,
    options: { headers: Record<string, string>; body: string | Uint8Array; signature?: InboundSignatureInput; sourceId?: string },
  ): Promise<InboundSignatureCheck> {
    const body: Record<string, unknown> = { headers: options.headers };
    if (typeof options.body === "string") body.body = options.body;
    else Object.assign(body, { body: Buffer.from(options.body).toString("base64"), body_encoding: "base64" });
    if (options.signature) body.signature = signatureBody(options.signature);
    if (options.sourceId !== undefined) body.source_id = options.sourceId;
    const data = await this.http.post<{ verified: boolean; reason?: string | null }>(this.path(handle, "signature-check"), body);
    return { verified: data.verified, reason: data.reason ?? null };
  }

  async listEvents(
    handle: string,
    sourceId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<InboundEventPage> {
    const data = await this.http.get<{ events: RawInboundEvent[]; next_cursor?: string | null }>(
      this.path(handle, sourceId, "events"), { limit: options.limit, cursor: options.cursor },
    );
    return { events: data.events.map(parseInboundEvent), nextCursor: data.next_cursor ?? null };
  }

  /** Includes the received `request`. */
  async getEvent(handle: string, sourceId: string, eventId: string): Promise<InboundEvent> {
    return parseInboundEvent(await this.http.get<RawInboundEvent>(this.path(handle, sourceId, "events", eventId)));
  }

  /** Deliver the event to the agent again. */
  async replayEvent(handle: string, sourceId: string, eventId: string): Promise<InboundEvent> {
    return parseInboundEvent(
      await this.http.post<RawInboundEvent>(this.path(handle, sourceId, "events", eventId, "replay")),
    );
  }

  /**
   * Report that the agent could not process a delivery. Requires the identity's own API key.
   * `deliveryId` is the `delivery_id` of the `inbound.received` payload; the server answers
   * 409 `stale_delivery` when the event has since been delivered again.
   */
  async reportInboundEventResult(
    handle: string,
    sourceId: string,
    eventId: string,
    result: { status: "failed"; error: string; deliveryId: string },
  ): Promise<void> {
    await this.http.post<void>(this.path(handle, sourceId, "events", eventId, "result"), {
      status: result.status,
      error: result.error,
      delivery_id: result.deliveryId,
    });
  }
}
