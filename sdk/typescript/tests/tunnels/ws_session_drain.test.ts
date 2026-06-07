/**
 * tests/tunnels/ws_session_drain.test.ts
 *
 * Drain edge: if a WS upgrade is caught mid-handshake when the origin
 * connection is draining, both the upgrade reply and the fallback reject
 * post on that (refusing) connection and throw. WsSession.run() must still
 * settle — not spin its pump-starter waiting on flags that never flip.
 */

import { describe, expect, it } from "vitest";
import {
  __testing,
  type InkboxWsHandler,
  type WsBridgeIO,
} from "../../src/tunnels/client/_ws.js";

const { WsSession } = __testing;

describe("WsSession — drain edge", () => {
  it("run() settles (does not hang) when both reply and reject throw", async () => {
    // Origin draining: postUpgradeReply AND rejectUpgrade both fail.
    const bridge: WsBridgeIO = {
      async sendFrame() {},
      recv() {
        return (async function* () {})();
      },
      async closeStream() {},
      async postUpgradeReply() {
        throw new Error("origin draining");
      },
      async rejectUpgrade() {
        throw new Error("origin draining");
      },
    };
    const session = new WsSession({
      url: "wss://host/ws",
      headers: new Map(),
      offeredProtocols: [],
      acceptDeadlineMs: 30_000,
      bridge,
    });
    const handler: InkboxWsHandler = async (ws) => {
      await ws.accept(); // throws — postUpgradeReply fails on the draining origin
    };

    const outcome = await Promise.race([
      session.run(handler).then(
        () => "settled",
        () => "settled",
      ),
      new Promise<string>((r) => setTimeout(() => r("HANG"), 2000)),
    ]);
    expect(outcome).toBe("settled");
  });
});
