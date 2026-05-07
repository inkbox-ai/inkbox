/**
 * Edge URL forwarding to ``https://`` upstream variants.
 *
 * Verifies that ``forwardToVerifyTls`` and ``forwardToCaBundle`` are
 * actually consulted by the edge URL-forwarding path — before the fix
 * the call site used ``globalThis.fetch`` with no TLS overrides, so
 * ``https://localhost`` self-signed certs failed regardless of opts.
 */

import { describe, expect, it } from "vitest";
import * as https from "node:https";
import * as net from "node:net";
import { forwardEnvelopeToUrl } from "../../src/tunnels/client/_url_forward.js";
import type { Envelope } from "../../src/tunnels/client/_envelope.js";
import { generateSelfSignedCert } from "./_test_cert.js";

async function spawnHttpsEcho(): Promise<{
  port: number;
  certPem: string;
  close: () => Promise<void>;
}> {
  const { cert, key } = await generateSelfSignedCert();
  const server = https.createServer({ cert, key }, (req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("hello-from-https-upstream");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    certPem: cert,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function envelope(): Envelope {
  return {
    requestId: "r-edge-https",
    method: "GET",
    path: "/probe",
    routeKind: "webhook",
    wsId: null,
    forwardedHeaders: [],
    body: Buffer.alloc(0),
    bodyUri: null,
    forwardedForIp: null,
    tcpId: null,
    sniHost: null,
    extraMeta: {},
  };
}

describe("edge URL forwarding — https upstream", () => {
  it("succeeds with verifyTls=false against a self-signed upstream", async () => {
    const upstream = await spawnHttpsEcho();
    try {
      const result = await forwardEnvelopeToUrl({
        envelope: envelope(),
        forwardTo: `https://127.0.0.1:${upstream.port}`,
        publicHost: "agent.test",
        maxResponseBytes: 1_000_000,
        verifyTls: false,
      });
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.status).toBe(200);
        expect(result.body.toString("utf-8")).toBe(
          "hello-from-https-upstream",
        );
      }
    } finally {
      await upstream.close();
    }
  }, 10_000);

  it("fails with the default verify-on against a self-signed upstream", async () => {
    const upstream = await spawnHttpsEcho();
    try {
      const result = await forwardEnvelopeToUrl({
        envelope: envelope(),
        forwardTo: `https://127.0.0.1:${upstream.port}`,
        publicHost: "agent.test",
        maxResponseBytes: 1_000_000,
        // verifyTls defaults to true (no override) — system trust store
        // doesn't have our self-signed cert, so the connection fails.
      });
      expect(result.kind).toBe("upstream-unreachable");
    } finally {
      await upstream.close();
    }
  }, 10_000);

  it("succeeds when caBundle pins the upstream cert", async () => {
    const upstream = await spawnHttpsEcho();
    try {
      const result = await forwardEnvelopeToUrl({
        envelope: envelope(),
        forwardTo: `https://127.0.0.1:${upstream.port}`,
        publicHost: "agent.test",
        maxResponseBytes: 1_000_000,
        caBundle: upstream.certPem,
      });
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.status).toBe(200);
      }
    } finally {
      await upstream.close();
    }
  }, 10_000);
});
