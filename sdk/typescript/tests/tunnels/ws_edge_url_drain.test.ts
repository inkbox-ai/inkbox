/**
 * tests/tunnels/ws_edge_url_drain.test.ts
 *
 * On a server-drain close, the URL-forward WS bridge gives the SDK-owned
 * upstream leg a clean, typed `server_draining` (4500) WS CLOSE instead of
 * an abrupt socket RST.
 */

import { describe, expect, it } from "vitest";
import * as net from "node:net";
import { pumpWsUrlEdgeBridge } from "../../src/tunnels/client/_ws_url_edge_bridge.js";
import {
  WsServerDraining,
  type WsBridgeIO,
} from "../../src/tunnels/client/_ws.js";
import {
  WS_OPCODE_CLOSE,
} from "../../src/tunnels/client/_wsframe.js";
import { decodeClientFrame } from "../../src/tunnels/client/_ws_passthrough.js";

describe("pumpWsUrlEdgeBridge — server drain", () => {
  it("sends a server_draining (4500) WS CLOSE to the upstream leg on drain", async () => {
    const received: Buffer[] = [];
    const server = net.createServer((s) => {
      s.on("data", (c: Buffer) => received.push(c));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as net.AddressInfo).port;
    const sock = net.connect(port, "127.0.0.1");
    await new Promise<void>((r) => sock.once("connect", () => r()));

    // A bridge whose inbound iterator drains on the first pull, exactly as
    // the runtime's recv() does when the connection is draining.
    const bridge: WsBridgeIO = {
      async sendFrame() {},
      recv() {
        return (async function* () {
          throw new WsServerDraining();
        })();
      },
      async closeStream() {},
      async postUpgradeReply() {},
      async rejectUpgrade() {},
    };

    await pumpWsUrlEdgeBridge({
      upstream: {
        socket: sock,
        leftover: Buffer.alloc(0),
        headers: [],
        subprotocol: null,
      },
      bridge,
    });
    await new Promise((r) => setTimeout(r, 50)); // let the FIN/frame flush

    let closeCode = -1;
    const dec = decodeClientFrame(received, { requireMask: true });
    if (dec.kind === "frame" && dec.opcode === WS_OPCODE_CLOSE) {
      closeCode = dec.payload.readUInt16BE(0);
    }
    expect(closeCode).toBe(4500);
    server.close();
  });
});
