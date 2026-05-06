/**
 * inkbox-tunnels/client/_envelope.ts
 *
 * Pure synchronous envelope parser. Mirrors Python `_envelope.py` line
 * for line. No I/O. The `inkbox-body-uri` materialization step lives in
 * `_runtime.ts` so this module stays trivially unit-testable.
 */

import {
  HOP_BY_HOP_RESPONSE,
  INKBOX_FORWARDED_HEADER_PREFIX,
  INKBOX_NAMESPACE_PREFIX,
  TunnelMetaHeader,
  TunnelRouteKind,
} from "./_protocol.js";

export type RouteKind = TunnelRouteKind;

export interface Envelope {
  requestId: string;
  method: string;
  path: string;
  routeKind: RouteKind;
  wsId: string | null;
  forwardedHeaders: Array<[string, string]>;
  body: Buffer;
  bodyUri: string | null;
  forwardedForIp: string | null;
  tcpId: string | null;
  sniHost: string | null;
  extraMeta: Record<string, string>;
}

/**
 * `Envelope` exposed read-only on `InkboxRequestContext`. Same shape;
 * separate type so callers see immutability at the type level.
 */
export type ReadonlyEnvelope = Readonly<{
  requestId: string;
  method: string;
  path: string;
  routeKind: RouteKind;
  wsId: string | null;
  forwardedHeaders: ReadonlyArray<readonly [string, string]>;
  body: Buffer;
  bodyUri: string | null;
  forwardedForIp: string | null;
  tcpId: string | null;
  sniHost: string | null;
  extraMeta: Readonly<Record<string, string>>;
}>;

/**
 * Parse a `/_system/intake` response into an {@link Envelope}.
 *
 * Returns `null` if the headers are missing the required
 * `inkbox-request-id` field.
 *
 * The returned envelope's `body` may be empty when the server has
 * offloaded the body to an out-of-band fetch URL — in that case
 * `bodyUri` is set and the runtime materializes it before dispatch.
 */
export function parseEnvelope(
  headers: Array<[string, string]>,
  body: Buffer,
): Envelope | null {
  let requestId = "";
  let method = "GET";
  let path = "/";
  let routeKind: RouteKind = TunnelRouteKind.WEBHOOK;
  let wsId: string | null = null;
  let tcpId: string | null = null;
  let sniHost: string | null = null;
  let bodyUri: string | null = null;
  let forwardedForIp: string | null = null;
  const forwarded: Array<[string, string]> = [];
  const extra: Record<string, string> = {};

  for (const [k, v] of headers) {
    const kl = k.toLowerCase();
    switch (kl) {
      case TunnelMetaHeader.REQUEST_ID:
        requestId = v;
        break;
      case TunnelMetaHeader.METHOD:
        method = v;
        break;
      case TunnelMetaHeader.PATH:
        path = v;
        break;
      case TunnelMetaHeader.ROUTE_KIND:
        if (
          v === TunnelRouteKind.WEBHOOK ||
          v === TunnelRouteKind.WS_UPGRADE ||
          v === TunnelRouteKind.TCP_STREAM
        ) {
          routeKind = v;
        }
        break;
      case TunnelMetaHeader.WS_ID:
        wsId = v;
        break;
      case TunnelMetaHeader.TCP_ID:
        tcpId = v;
        break;
      case TunnelMetaHeader.SNI_HOST:
        sniHost = v;
        break;
      case TunnelMetaHeader.BODY_URI:
        bodyUri = v;
        break;
      case TunnelMetaHeader.FORWARDED_FOR:
        forwardedForIp = v;
        extra[kl] = v;
        break;
      default:
        if (kl.startsWith(INKBOX_FORWARDED_HEADER_PREFIX)) {
          forwarded.push([kl.slice(INKBOX_FORWARDED_HEADER_PREFIX.length), v]);
        } else if (kl.startsWith(INKBOX_NAMESPACE_PREFIX)) {
          extra[kl] = v;
        }
        break;
    }
  }

  if (!requestId) return null;
  return {
    requestId,
    method,
    path,
    routeKind,
    wsId,
    forwardedHeaders: forwarded,
    body,
    bodyUri,
    forwardedForIp,
    tcpId,
    sniHost,
    extraMeta: extra,
  };
}

/** Drop hop-by-hop headers from an upstream response before forwarding. */
export function filterResponseHeaders(
  headers: Array<[string, string]>,
): Array<[string, string]> {
  return headers.filter(([k]) => !HOP_BY_HOP_RESPONSE.has(k.toLowerCase()));
}
