import assert from "node:assert/strict";
import test from "node:test";
import { tunnelGetRecord } from "../dist/commands/tunnel.js";

test("tunnel get output includes the last recorded disconnect", () => {
  const disconnectedAt = new Date("2026-08-02T07:30:45Z");
  const record = tunnelGetRecord({
    id: "11111111-1111-1111-1111-111111111111",
    organizationId: "org_test",
    tunnelName: "my-agent",
    agentIdentityId: null,
    tlsMode: "edge",
    certPem: null,
    certFingerprintSha256: null,
    certExpiresAt: null,
    status: "active",
    lastConnectedAt: null,
    lastConnectedIpAddr: null,
    lastDisconnectedAt: disconnectedAt,
    currentlyConnected: false,
    publicHost: "my-agent.inkboxwire.com",
    zone: "inkboxwire.com",
    metadata: {},
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-02T07:30:45Z"),
  });

  assert.equal(record.lastDisconnectedAt, disconnectedAt);
});

test("tunnel create posts to the identity's tunnel endpoint", async () => {
  const { execFile } = await import("node:child_process");
  const http = await import("node:http");
  const { fileURLToPath } = await import("node:url");
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push([req.method, req.url]);
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "11111111-1111-1111-1111-111111111111", organization_id: "org_test", tunnel_name: "my-agent",
      agent_identity_id: null, tls_mode: "edge", cert_pem: null, cert_fingerprint_sha256: null,
      cert_expires_at: null, status: "active", last_connected_at: null, last_connected_ip_addr: null,
      last_disconnected_at: null, currently_connected: false, public_host: "my-agent.inkboxwire.com",
      zone: "inkboxwire.com", metadata: {}, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    const stdout = await new Promise((resolve, reject) => execFile(process.execPath,
      [cli, "--api-key", "test-key", "--base-url", `http://127.0.0.1:${server.address().port}`, "--json", "tunnel", "create", "my-agent"],
      { timeout: 15000, env: { ...process.env, NODE_USE_ENV_PROXY: "0" } },
      (error, out) => (error ? reject(error) : resolve(out))));
    assert.deepEqual(requests, [["POST", "/api/v1/identities/my-agent/tunnel"]]);
    assert.equal(JSON.parse(stdout).publicHost, "my-agent.inkboxwire.com");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
