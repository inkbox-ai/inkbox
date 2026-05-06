/**
 * inkbox-tunnels/client/_protocol.ts
 *
 * Single source of truth for the wire protocol in the TS SDK. Mirrors
 * the server-side definitions in `servers/src/data_models/tunnel.py`.
 *
 * The companion manifest at
 * `sdk/typescript/protocol/tunnel_protocol_constants.json` is the
 * cross-SDK forcing function; the contract test in
 * `tests/tunnels/protocol_contract.test.ts` asserts the constants here
 * match it byte-for-byte. When the protocol changes, update both files
 * in lockstep.
 */

export const INKBOX_NAMESPACE_PREFIX = "inkbox-" as const;
export const INKBOX_FORWARDED_HEADER_PREFIX = "inkbox-h-" as const;

/**
 * The closed set of inkbox-defined meta headers exchanged on the
 * `/_system/intake` and `/_system/response/{id}` streams.
 */
export const TunnelMetaHeader = {
  REQUEST_ID: "inkbox-request-id",
  METHOD: "inkbox-method",
  PATH: "inkbox-path",
  ROUTE_KIND: "inkbox-route-kind",
  STATUS: "inkbox-status",
  WS_ID: "inkbox-ws-id",
  TCP_ID: "inkbox-tcp-id",
  SNI_HOST: "inkbox-sni-host",
  BODY_URI: "inkbox-body-uri",
  FORWARDED_FOR: "inkbox-forwarded-for",
  REASON: "inkbox-reason",
} as const;
export type TunnelMetaHeader =
  (typeof TunnelMetaHeader)[keyof typeof TunnelMetaHeader];

/** Values for the `inkbox-route-kind` meta header. */
export const TunnelRouteKind = {
  WEBHOOK: "webhook",
  WS_UPGRADE: "ws-upgrade",
  TCP_STREAM: "tcp-stream",
} as const;
export type TunnelRouteKind =
  (typeof TunnelRouteKind)[keyof typeof TunnelRouteKind];

/** ALPN-style subprotocols negotiated on extended-CONNECT bridge streams. */
export const TunnelSubprotocol = {
  WS: "inkbox-tunnel-ws",
  TCP: "inkbox-tunnel-tcp",
} as const;
export type TunnelSubprotocol =
  (typeof TunnelSubprotocol)[keyof typeof TunnelSubprotocol];

/** Control-plane HTTP/2 paths exposed by the tunnel server. */
export const ControlPaths = {
  HELLO: "/_system/hello",
  INTAKE: "/_system/intake",
  RESPONSE_PREFIX: "/_system/response/",
  WS_PREFIX: "/_system/ws/",
  TCP_PREFIX: "/_system/tcp/",
} as const;

/** SDK-side request headers used on every control-plane stream. */
export const ControlHeaders = {
  TUNNEL_ID: "x-tunnel-id",
  TUNNEL_SECRET: "x-tunnel-secret",
  OWNER_TOKEN: "x-owner-token",
  POOL_SLOT: "x-pool-slot",
  POOL_SIZE: "x-pool-size",
} as const;

/** Hop-by-hop request headers stripped before forwarding upstream. */
export const HOP_BY_HOP_REQUEST: ReadonlySet<string> = new Set([
  "host",
  "connection",
  "upgrade",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "proxy-authenticate",
  "proxy-authorization",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
]);

/** Hop-by-hop response headers stripped before forwarding back. */
export const HOP_BY_HOP_RESPONSE: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);
