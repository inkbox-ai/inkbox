/**
 * Inbound sources for hosted agents. Each source has a public URL that
 * accepts requests from an external service, optionally verifies the
 * sender's signature, and delivers each request to the agent as an
 * `inbound.received` event.
 */

import { HttpTransport } from "./_http.js";
import type { InboundWebhookRequest } from "./webhooks/types.js";

export type InboundSignatureScheme = "stripe" | "github" | "slack" | "standard-webhooks" | "hmac";
export type InboundEventStatus = "pending" | "delivered" | "failed";

/** Sender signature check. `header`/`algorithm`/`encoding`/`prefix` apply to `hmac`. */
export interface InboundSignatureInput {
  scheme: InboundSignatureScheme;
  secret: string;
  header?: string;
  algorithm?: "sha256" | "sha1";
  encoding?: "hex" | "base64";
  prefix?: string;
}

/** Signature settings as returned; the secret is never returned. */
export interface InboundSignature {
  scheme: InboundSignatureScheme;
  header?: string | null;
  algorithm?: string | null;
  encoding?: string | null;
  prefix?: string | null;
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
  id: string; name: string; url: string; signature?: InboundSignature | null;
  handler: InboundHandler; created_at: string; updated_at: string;
}

interface RawInboundEvent {
  id: string; source_id: string; received_at: string; status: InboundEventStatus; attempts: number;
  last_error?: string | null; signature_verified: boolean; content_type?: string | null; size_bytes: number;
  request?: InboundWebhookRequest | null;
}

export function parseInboundSource(r: RawInboundSource): InboundSource {
  return {
    id: r.id, name: r.name, url: r.url, signature: r.signature ?? null, handler: r.handler,
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
    const body = { name: options.name, signature: options.signature ?? null, handler: options.handler };
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
    return parseInboundSource(await this.http.patch<RawInboundSource>(this.path(handle, sourceId), options));
  }

  async deleteSource(handle: string, sourceId: string): Promise<void> {
    await this.http.delete(this.path(handle, sourceId));
  }

  /** Issue a new URL; the previous URL stops accepting requests. */
  async rotateSource(handle: string, sourceId: string): Promise<InboundSource> {
    return parseInboundSource(await this.http.post<RawInboundSource>(this.path(handle, sourceId, "rotate")));
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

  /** Report that the agent could not process an event. Requires the identity's own API key. */
  async reportInboundEventResult(
    handle: string,
    sourceId: string,
    eventId: string,
    result: { status: "failed"; error: string },
  ): Promise<void> {
    await this.http.post<void>(this.path(handle, sourceId, "events", eventId, "result"), result);
  }
}
