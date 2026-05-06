import { describe, it, expect } from "vitest";
import {
  buildAcceptReply,
  buildInboundHeaders,
  parseOfferedSubprotocols,
} from "../../src/tunnels/client/_ws.js";
import type { Envelope } from "../../src/tunnels/client/_envelope.js";
import { TunnelRouteKind } from "../../src/tunnels/client/_protocol.js";

function makeEnvelope(headers: Array<[string, string]> = []): Envelope {
  return {
    requestId: "r-1",
    method: "GET",
    path: "/ws",
    routeKind: TunnelRouteKind.WS_UPGRADE,
    wsId: "ws-1",
    forwardedHeaders: headers,
    body: Buffer.alloc(0),
    bodyUri: null,
    forwardedForIp: null,
    tcpId: null,
    sniHost: null,
    extraMeta: {},
  };
}

describe("parseOfferedSubprotocols", () => {
  it("splits and trims comma-separated subprotocols", () => {
    expect(
      parseOfferedSubprotocols([
        ["Sec-WebSocket-Protocol", "graphql-ws, chat , v2"],
      ]),
    ).toEqual(["graphql-ws", "chat", "v2"]);
  });

  it("ignores other headers", () => {
    expect(
      parseOfferedSubprotocols([
        ["content-type", "application/json"],
        ["X-Whatever", "ok"],
      ]),
    ).toEqual([]);
  });

  it("returns empty for missing or empty Sec-WebSocket-Protocol", () => {
    expect(parseOfferedSubprotocols([])).toEqual([]);
    expect(
      parseOfferedSubprotocols([["sec-websocket-protocol", "  ,  , "]]),
    ).toEqual([]);
  });
});

describe("buildAcceptReply", () => {
  it("returns empty when no protocol or headers given", () => {
    expect(buildAcceptReply(undefined)).toEqual([]);
    expect(buildAcceptReply({})).toEqual([]);
  });

  it("includes subprotocol when provided", () => {
    expect(buildAcceptReply({ protocol: "chat" })).toEqual([
      ["sec-websocket-protocol", "chat"],
    ]);
  });

  it("strips hop-by-hop response headers", () => {
    expect(
      buildAcceptReply({
        protocol: "chat",
        headers: [
          ["Connection", "close"],
          ["x-custom", "ok"],
          ["transfer-encoding", "chunked"],
        ],
      }),
    ).toEqual([
      ["sec-websocket-protocol", "chat"],
      ["x-custom", "ok"],
    ]);
  });
});

describe("buildInboundHeaders", () => {
  it("lowercases all header names", () => {
    const env = makeEnvelope([
      ["X-Custom", "1"],
      ["Authorization", "Bearer abc"],
    ]);
    const out = buildInboundHeaders(env);
    expect(out.get("x-custom")).toBe("1");
    expect(out.get("authorization")).toBe("Bearer abc");
  });
});
