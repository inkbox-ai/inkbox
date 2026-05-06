import { describe, it, expect } from "vitest";
import {
  filterResponseHeaders,
  parseEnvelope,
} from "../../src/tunnels/client/_envelope.js";
import { TunnelRouteKind } from "../../src/tunnels/client/_protocol.js";

describe("parseEnvelope", () => {
  it("returns null when inkbox-request-id is missing", () => {
    expect(parseEnvelope([], Buffer.alloc(0))).toBeNull();
    expect(
      parseEnvelope([["inkbox-method", "GET"]], Buffer.alloc(0)),
    ).toBeNull();
  });

  it("parses a minimal webhook envelope", () => {
    const env = parseEnvelope(
      [
        ["inkbox-request-id", "req-1"],
        ["inkbox-method", "POST"],
        ["inkbox-path", "/webhook?x=1"],
        ["inkbox-route-kind", "webhook"],
        ["inkbox-h-content-type", "application/json"],
        ["inkbox-h-x-custom", "ok"],
      ],
      Buffer.from('{"hello":"world"}'),
    );
    expect(env).not.toBeNull();
    expect(env!.requestId).toBe("req-1");
    expect(env!.method).toBe("POST");
    expect(env!.path).toBe("/webhook?x=1");
    expect(env!.routeKind).toBe(TunnelRouteKind.WEBHOOK);
    expect(env!.forwardedHeaders).toEqual([
      ["content-type", "application/json"],
      ["x-custom", "ok"],
    ]);
    expect(env!.body.toString()).toBe('{"hello":"world"}');
  });

  it("surfaces inkbox-body-uri", () => {
    const env = parseEnvelope(
      [
        ["inkbox-request-id", "r"],
        ["inkbox-body-uri", "https://example.com/body"],
      ],
      Buffer.alloc(0),
    );
    expect(env!.bodyUri).toBe("https://example.com/body");
  });

  it("surfaces forwarded-for and SNI host", () => {
    const env = parseEnvelope(
      [
        ["inkbox-request-id", "r"],
        ["inkbox-forwarded-for", "203.0.113.5"],
        ["inkbox-sni-host", "my.example.com"],
      ],
      Buffer.alloc(0),
    );
    expect(env!.forwardedForIp).toBe("203.0.113.5");
    expect(env!.sniHost).toBe("my.example.com");
    expect(env!.extraMeta["inkbox-forwarded-for"]).toBe("203.0.113.5");
  });

  it("preserves WS upgrade route kind and ws-id", () => {
    const env = parseEnvelope(
      [
        ["inkbox-request-id", "r"],
        ["inkbox-route-kind", "ws-upgrade"],
        ["inkbox-ws-id", "ws-abc"],
      ],
      Buffer.alloc(0),
    );
    expect(env!.routeKind).toBe(TunnelRouteKind.WS_UPGRADE);
    expect(env!.wsId).toBe("ws-abc");
  });

  it("preserves TCP-stream envelope", () => {
    const env = parseEnvelope(
      [
        ["inkbox-request-id", "r"],
        ["inkbox-route-kind", "tcp-stream"],
        ["inkbox-tcp-id", "tcp-1"],
        ["inkbox-sni-host", "example.com"],
      ],
      Buffer.alloc(0),
    );
    expect(env!.routeKind).toBe(TunnelRouteKind.TCP_STREAM);
    expect(env!.tcpId).toBe("tcp-1");
  });

  it("ignores unknown route-kind values (keeps default webhook)", () => {
    const env = parseEnvelope(
      [
        ["inkbox-request-id", "r"],
        ["inkbox-route-kind", "novel-thing"],
      ],
      Buffer.alloc(0),
    );
    expect(env!.routeKind).toBe(TunnelRouteKind.WEBHOOK);
  });

  it("treats header names case-insensitively", () => {
    const env = parseEnvelope(
      [
        ["INKBOX-Request-ID", "r"],
        ["Inkbox-Method", "PATCH"],
        ["INKBOX-H-X-Trace", "abc"],
      ],
      Buffer.alloc(0),
    );
    expect(env!.requestId).toBe("r");
    expect(env!.method).toBe("PATCH");
    expect(env!.forwardedHeaders).toEqual([["x-trace", "abc"]]);
  });
});

describe("filterResponseHeaders", () => {
  it("drops hop-by-hop response headers", () => {
    const filtered = filterResponseHeaders([
      ["content-type", "text/plain"],
      ["connection", "close"],
      ["transfer-encoding", "chunked"],
      ["x-custom", "ok"],
      ["TE", "trailers"],
    ]);
    expect(filtered).toEqual([
      ["content-type", "text/plain"],
      ["x-custom", "ok"],
    ]);
  });
});
