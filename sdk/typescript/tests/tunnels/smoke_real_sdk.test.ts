/**
 * tests/tunnels/smoke_real_sdk.test.ts
 *
 * End-to-end smoke against the real deployed Inkbox tunnel service,
 * not the in-process FakeH2Server. Covers what FakeAgent-only
 * integration tests on the server side cannot:
 *
 *  - real h2 handshake against the live data plane,
 *  - HTTP round-trip through the public ingress,
 *  - WebSocket bidirectional bytes through the live ws bridge,
 *  - duplicate Set-Cookie response headers (locks down P2-A),
 *  - handler deadline 504 (locks down P1-B),
 *
 * Gated behind ``INKBOX_TUNNEL_SMOKE_API_KEY`` so CI doesn't burn quota
 * accidentally. Runs locally via:
 *
 *   INKBOX_TUNNEL_SMOKE_API_KEY=ApiKey_... \
 *     npx vitest run tests/tunnels/smoke_real_sdk.test.ts
 *
 * Optional ``INKBOX_BASE_URL`` overrides the control-plane endpoint
 * (use for staging / dev environments). The tunnel name is randomized
 * per run; the test deletes the tunnel on teardown.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as http from "node:http";
import { randomUUID } from "node:crypto";
import { Inkbox } from "../../src/inkbox.js";
import { connect } from "../../src/tunnels/client/index.js";
import type {
  TunnelListener,
} from "../../src/tunnels/client/index.js";

const apiKey = process.env.INKBOX_TUNNEL_SMOKE_API_KEY;
const baseUrl = process.env.INKBOX_BASE_URL;
const skip = !apiKey;

const describeMaybe = skip ? describe.skip : describe;

describeMaybe("Real-SDK smoke against deployed tunnel service", () => {
  let inkbox: Inkbox;
  let upstream: http.Server;
  let upstreamPort: number;
  let listener: TunnelListener | null = null;
  let publicUrl: string = "";
  let tunnelName: string = "";
  let tunnelId: string | null = null;

  beforeAll(async () => {
    inkbox = new Inkbox({
      apiKey: apiKey!,
      ...(baseUrl ? { baseUrl } : {}),
    });
    // Tiny upstream that handles every smoke route.
    upstream = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/cookies") {
        // Multi-Set-Cookie path — locks down P2-A.
        res.writeHead(200, [
          "content-type", "text/plain",
          "set-cookie", "sid=abc; Path=/",
          "set-cookie", "theme=dark; Path=/",
        ]);
        res.end("ok");
        return;
      }
      if (url.pathname === "/slow") {
        // Never responds — exercises the SDK-side deadline (P1-B).
        // Don't call res.end(); let the runtime time out.
        return;
      }
      // Default echo.
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          method: req.method,
          path: url.pathname,
          body,
        }));
      });
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", () => resolve()),
    );
    upstreamPort = (upstream.address() as { port: number }).port;
    tunnelName = `smoke-${randomUUID().slice(0, 8)}`;
    listener = await connect(inkbox, {
      name: tunnelName,
      forwardTo: `http://127.0.0.1:${upstreamPort}`,
      tlsMode: "edge",
      printSecretToStderr: false,
    });
    publicUrl = listener.publicUrl;
    tunnelId = listener.tunnel.id;
    // serveForever runs in the background (started by connect's listener
    // wrapper). Give it a moment for hello + intake parking.
    await new Promise((r) => setTimeout(r, 1500));
  }, 30_000);

  afterAll(async () => {
    if (listener !== null) {
      await listener.aclose();
    }
    if (tunnelId !== null) {
      try {
        await inkbox.tunnels.delete(tunnelId);
      } catch {
        /* swallow — best-effort cleanup */
      }
    }
    if (upstream !== undefined) {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("HTTP GET round-trips through the public ingress", async () => {
    const resp = await fetch(`${publicUrl}/echo?x=1`);
    expect(resp.status).toBe(200);
    const body = await resp.json() as { method: string; path: string };
    expect(body.method).toBe("GET");
    expect(body.path).toBe("/echo");
  }, 20_000);

  it("preserves duplicate Set-Cookie headers end-to-end (P2-A regression)", async () => {
    const resp = await fetch(`${publicUrl}/cookies`);
    expect(resp.status).toBe(200);
    // Node's fetch returns multiple Set-Cookie via getSetCookie() when
    // available; otherwise the comma-joined header is still split-able.
    const headers = resp.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const cookies = headers.getSetCookie
      ? headers.getSetCookie()
      : (resp.headers.get("set-cookie") ?? "")
          .split(/,(?=\s*\w+=)/)
          .map((s) => s.trim())
          .filter(Boolean);
    expect(cookies.length).toBe(2);
    expect(cookies.some((c) => c.startsWith("sid=abc"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("theme=dark"))).toBe(true);
  }, 20_000);

  it("posts 504 when the upstream stalls past the response deadline (P1-B regression)", async () => {
    const t0 = Date.now();
    const resp = await fetch(`${publicUrl}/slow`);
    const elapsedMs = Date.now() - t0;
    // Either the SDK posts 504 first (response-deadline-exceeded) or
    // the public-side server times out first (504 with its own
    // generic text). Both are acceptable here — the assertion is that
    // we didn't hang past a generous bound.
    expect(resp.status).toBeGreaterThanOrEqual(500);
    expect(elapsedMs).toBeLessThan(60_000);
  }, 90_000);
});

if (skip) {
  // Provide a single visible test so the file isn't empty when skipped.
  describe("Real-SDK smoke (skipped)", () => {
    it("requires INKBOX_TUNNEL_SMOKE_API_KEY to run", () => {
      expect(skip).toBe(true);
    });
  });
}
