/**
 * WebSocket over h1 + callable — drives an InkboxWsHandler through
 * InProcH1ParserPlaintext + CallableDispatch end-to-end at the parser
 * layer.
 */

import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { CallableDispatch } from "../../src/tunnels/client/_dispatch.js";
import { InProcH1ParserPlaintext } from "../../src/tunnels/client/_h1_server.js";
import {
  computeWsAccept,
  encodeServerFrame,
} from "../../src/tunnels/client/_ws_passthrough.js";
import {
  WS_OPCODE_BINARY,
  WS_OPCODE_CLOSE,
  WS_OPCODE_TEXT,
  encodeWsFrame,
} from "../../src/tunnels/client/_wsframe.js";

function buildUpgrade(path = "/ws"): { req: Buffer; key: string; accept: string } {
  const keyRaw = randomBytes(16);
  const key = keyRaw.toString("base64");
  const accept = computeWsAccept(key);
  const req = Buffer.from(
    `GET ${path} HTTP/1.1\r\n` +
      "Host: agent.test\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Key: ${key}\r\n` +
      "Sec-WebSocket-Version: 13\r\n\r\n",
    "ascii",
  );
  return { req, key, accept };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  stepMs = 5,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

describe("ws over h1 + callable", () => {
  it("completes upgrade, exchanges frames, and closes", async () => {
    let received: string | Buffer | null = null;

    const dispatch = new CallableDispatch({
      handler: async () => new Response("never"),
      wsHandler: async (ws) => {
        await ws.accept();
        for await (const msg of ws) {
          received = msg;
          if (typeof msg === "string") {
            await ws.send(`echo:${msg}`);
          }
          break;
        }
      },
      publicHost: "agent.test",
      maxOutboundBodyBytes: 1_000_000,
    });

    const parser = new InProcH1ParserPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });

    const out: Buffer[] = [];
    const pump = parser.pumpOutbound(async (c) => {
      out.push(c);
    });

    const { req, accept } = buildUpgrade();
    await parser.feed(req);

    await waitFor(() => Buffer.concat(out).includes("101 Switching Protocols"));
    const head = Buffer.concat(out).toString("latin1");
    expect(head).toContain(`Sec-WebSocket-Accept: ${accept}`);

    // Strip the 101 head from the buffer.
    const merged = Buffer.concat(out);
    const idx = merged.indexOf("\r\n\r\n");
    out.length = 0;
    out.push(merged.subarray(idx + 4));

    // Send TEXT frame from client.
    const textFrame = encodeWsFrame(
      WS_OPCODE_TEXT,
      Buffer.from("hello-ws"),
      { mask: true },
    );
    await parser.feed(textFrame);

    // Wait for echo response.
    await waitFor(() => {
      const m = Buffer.concat(out);
      if (m.length < 2) return false;
      const opcode = m[0] & 0x0f;
      const plen = m[1] & 0x7f;
      return opcode === WS_OPCODE_TEXT && plen > 0 && m.length >= 2 + plen;
    });
    const replyMerged = Buffer.concat(out);
    const replyOpcode = replyMerged[0] & 0x0f;
    const replyMasked = (replyMerged[1] & 0x80) !== 0;
    const replyLen = replyMerged[1] & 0x7f;
    expect(replyOpcode).toBe(WS_OPCODE_TEXT);
    expect(replyMasked).toBe(false); // server frames must NOT be masked
    expect(
      replyMerged.subarray(2, 2 + replyLen).toString("utf-8"),
    ).toBe("echo:hello-ws");

    expect(received).toBe("hello-ws");

    // Send CLOSE.
    const closeFrame = encodeWsFrame(
      WS_OPCODE_CLOSE,
      Buffer.from([0x03, 0xe8]),
      { mask: true },
    );
    await parser.feed(closeFrame);

    await parser.aclose();
    try {
      await Promise.race([
        pump,
        new Promise((r) => setTimeout(r, 1000)),
      ]);
    } catch {
      /* swallow */
    }
  });

  it("rejects upgrade with 403 when handler closes before accept", async () => {
    const dispatch = new CallableDispatch({
      handler: async () => new Response("never"),
      wsHandler: async (ws) => {
        await ws.close(1008, "policy");
      },
      publicHost: "agent.test",
      maxOutboundBodyBytes: 1_000_000,
    });

    const parser = new InProcH1ParserPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });

    const out: Buffer[] = [];
    const pump = parser.pumpOutbound(async (c) => {
      out.push(c);
    });

    const { req } = buildUpgrade();
    await parser.feed(req);

    await waitFor(() =>
      Buffer.concat(out).toString("latin1").includes("HTTP/1.1 403"),
    );
    expect(Buffer.concat(out).toString("latin1")).toContain("HTTP/1.1 403");

    await parser.aclose();
    try {
      await Promise.race([
        pump,
        new Promise((r) => setTimeout(r, 500)),
      ]);
    } catch {
      /* swallow */
    }
  });

  it("returns 501 when no wsHandler is configured", async () => {
    const dispatch = new CallableDispatch({
      handler: async () => new Response("never"),
      // no wsHandler
      publicHost: "agent.test",
      maxOutboundBodyBytes: 1_000_000,
    });

    const parser = new InProcH1ParserPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });

    const out: Buffer[] = [];
    const pump = parser.pumpOutbound(async (c) => {
      out.push(c);
    });

    const { req } = buildUpgrade();
    await parser.feed(req);

    await waitFor(() =>
      Buffer.concat(out)
        .toString("latin1")
        .includes("HTTP/1.1 501"),
    );

    await parser.aclose();
    try {
      await Promise.race([
        pump,
        new Promise((r) => setTimeout(r, 500)),
      ]);
    } catch {
      /* swallow */
    }
  });

  it("propagates binary frames and Sec-WebSocket-Protocol", async () => {
    const dispatch = new CallableDispatch({
      handler: async () => new Response("never"),
      wsHandler: async (ws) => {
        expect(ws.offeredProtocols).toContain("v2.proto");
        await ws.accept({ protocol: "v2.proto" });
        for await (const msg of ws) {
          if (Buffer.isBuffer(msg)) {
            await ws.send(Buffer.from([...msg, 0xff]));
          }
          break;
        }
      },
      publicHost: "agent.test",
      maxOutboundBodyBytes: 1_000_000,
    });

    const parser = new InProcH1ParserPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });

    const out: Buffer[] = [];
    const pump = parser.pumpOutbound(async (c) => {
      out.push(c);
    });

    const keyRaw = randomBytes(16);
    const key = keyRaw.toString("base64");
    const upgrade = Buffer.from(
      `GET /ws HTTP/1.1\r\n` +
        "Host: agent.test\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Key: ${key}\r\n` +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Protocol: v1.proto, v2.proto\r\n\r\n",
      "ascii",
    );
    await parser.feed(upgrade);

    await waitFor(() =>
      Buffer.concat(out).toString("latin1").includes("Sec-WebSocket-Protocol: v2.proto"),
    );

    // Strip head.
    const merged = Buffer.concat(out);
    const idx = merged.indexOf("\r\n\r\n");
    out.length = 0;
    out.push(merged.subarray(idx + 4));

    const binFrame = encodeWsFrame(
      WS_OPCODE_BINARY,
      Buffer.from([1, 2, 3]),
      { mask: true },
    );
    await parser.feed(binFrame);

    await waitFor(() => {
      const m = Buffer.concat(out);
      if (m.length < 2) return false;
      const opcode = m[0] & 0x0f;
      const plen = m[1] & 0x7f;
      return opcode === WS_OPCODE_BINARY && plen > 0 && m.length >= 2 + plen;
    });
    const replyMerged = Buffer.concat(out);
    const replyLen = replyMerged[1] & 0x7f;
    expect(Array.from(replyMerged.subarray(2, 2 + replyLen))).toEqual([
      1, 2, 3, 0xff,
    ]);

    const closeFrame = encodeWsFrame(
      WS_OPCODE_CLOSE,
      Buffer.from([0x03, 0xe8]),
      { mask: true },
    );
    await parser.feed(closeFrame);
    await parser.aclose();
    try {
      await Promise.race([
        pump,
        new Promise((r) => setTimeout(r, 500)),
      ]);
    } catch {
      /* swallow */
    }
  });
});

// Silence "unused" warning for encodeServerFrame imported above for parity.
void encodeServerFrame;
