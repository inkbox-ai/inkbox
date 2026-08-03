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
