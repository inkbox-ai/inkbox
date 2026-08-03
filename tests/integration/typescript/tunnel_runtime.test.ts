import { randomUUID } from "node:crypto";
import * as http from "node:http";
import { describe, expect, it } from "vitest";
import { Inkbox } from "@inkbox/sdk";
import {
  connect,
  type TunnelListener,
} from "@inkbox/sdk/tunnels/connect";
import { loadBootstrapFromEnv, loadConfig } from "./helpers.js";

const describeTunnel = process.env.SDK_INTEGRATION_TUNNEL_SMOKE === "1"
  ? describe
  : describe.skip;

describeTunnel("TypeScript tunnel runtime", () => {
  it("preserves duplicate response cookies across the live tunnel", async () => {
    const config = loadConfig();
    const bootstrap = loadBootstrapFromEnv();
    const inkbox = new Inkbox({
      apiKey: bootstrap.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: config.httpTimeout,
    });
    const name = `ts-cookie-${randomUUID().slice(0, 8)}`;
    const upstream = http.createServer((_request, response) => {
      response.writeHead(200, [
        "content-type", "text/plain",
        "set-cookie", "sid=abc; Path=/",
        "set-cookie", "theme=dark; Path=/",
      ]);
      response.end("ok");
    });
    await new Promise<void>((resolve) => {
      upstream.listen(0, "127.0.0.1", resolve);
    });
    const upstreamPort = (upstream.address() as { port: number }).port;
    let listener: TunnelListener | null = null;
    let identityCreated = false;

    try {
      await inkbox.createIdentity(name);
      identityCreated = true;
      listener = await connect(inkbox, {
        name,
        forwardTo: `http://127.0.0.1:${upstreamPort}`,
      });
      void listener.serveForever();

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if ((await inkbox.tunnels.get(listener.tunnel.id)).currentlyConnected) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!(await inkbox.tunnels.get(listener.tunnel.id)).currentlyConnected) {
        throw new Error("tunnel listener did not become connected");
      }

      const response = await fetch(`${listener.publicUrl}/cookies`);
      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()).toEqual([
        "sid=abc; Path=/",
        "theme=dark; Path=/",
      ]);
    } finally {
      if (listener !== null) {
        await listener.aclose();
      }
      if (identityCreated) {
        try {
          const identity = await inkbox.getIdentity(name);
          await identity.delete();
        } catch {
          // Cleanup is completed by the integration harness if needed.
        }
      }
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }, 60_000);
});
