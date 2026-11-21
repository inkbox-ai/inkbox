import { describe, expect, it, vi } from "vitest";
import type { HttpTransport } from "../src/_http.js";
import { InboundResource, Inkbox } from "../src/index.js";
import { IdentitiesResource } from "../src/identities/resources/identities.js";

const SOURCE = {
  id: "inbsrc_1", name: "payments", url: "https://agent.example.test/inbound/token",
  signature: {
    secret_encoding: "text", header: "x-signature", format: "prefix", format_value: "sha256=", algorithm: "sha256",
    encoding: "hex", signed_content: "{body}", timestamp_from: "none", timestamp_value: null, max_age_seconds: null,
  },
  handler: { type: "agent", instructions: "Summarize the event." },
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};
const EVENT = {
  id: "inbev_1", source_id: "inbsrc_1", received_at: "2026-01-01T00:00:00Z", status: "failed", attempts: 2,
  last_error: "timeout", signature_verified: true, content_type: "application/json", size_bytes: 2,
};
const REQUEST = { method: "POST", query: {}, headers: {}, content_type: "application/json", body: "{}", body_encoding: "utf8" };

function setup() {
  const http = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  return { http, inbound: new InboundResource(http as unknown as HttpTransport) };
}

describe("InboundResource", () => {
  it("manages sources under the identity path", async () => {
    const { http, inbound } = setup();
    http.post.mockResolvedValue(SOURCE);
    http.get.mockResolvedValue(SOURCE);
    http.patch.mockResolvedValue(SOURCE);
    const signature = {
      secret: "synthetic-secret", header: "Example-Signature", format: "list" as const, formatValue: "v1",
      signedContent: "{timestamp}.{body}", timestampFrom: "list" as const, timestampValue: "t", maxAgeSeconds: 300,
    };
    const source = await inbound.createSource("@agent/x", { name: "payments", handler: { type: "script", command: "./run.sh" }, signature });
    expect(source).toMatchObject({ id: "inbsrc_1", createdAt: SOURCE.created_at, signature: {
      secretEncoding: "text", format: "prefix", formatValue: "sha256=", signedContent: "{body}", timestampFrom: "none",
      timestampValue: null, maxAgeSeconds: null,
    } });
    expect(http.post).toHaveBeenCalledWith("/%40agent%2Fx/inbound", { name: "payments", signature: {
      secret: "synthetic-secret", header: "Example-Signature", format: "list", format_value: "v1",
      signed_content: "{timestamp}.{body}", timestamp_from: "list", timestamp_value: "t", max_age_seconds: 300,
    }, handler: { type: "script", command: "./run.sh" } });
    await inbound.updateSource("agent", "inbsrc_1", { name: "renamed", signature: { secret: "s", header: "X-Sig", encoding: "base64" } });
    expect(http.patch).toHaveBeenLastCalledWith("/agent/inbound/inbsrc_1", { name: "renamed", signature: { secret: "s", header: "X-Sig", encoding: "base64" } });

    await inbound.createSource("agent", { name: "ci", handler: { type: "agent" } });
    expect(http.post).toHaveBeenLastCalledWith("/agent/inbound", { name: "ci", signature: null, handler: { type: "agent" } });

    http.get.mockResolvedValueOnce({ sources: [{ ...SOURCE, signature: null }] });
    expect((await inbound.listSources("agent"))[0].signature).toBeNull();
    expect(http.get).toHaveBeenLastCalledWith("/agent/inbound");
    await inbound.getSource("agent", "inbsrc_1");
    expect(http.get).toHaveBeenLastCalledWith("/agent/inbound/inbsrc_1");

    await inbound.updateSource("agent", "inbsrc_1", { signature: null });
    expect(http.patch).toHaveBeenLastCalledWith("/agent/inbound/inbsrc_1", { signature: null });
    await inbound.deleteSource("agent", "inbsrc_1");
    expect(http.delete).toHaveBeenCalledWith("/agent/inbound/inbsrc_1");
    await inbound.rotateSource("agent", "inbsrc_1");
    expect(http.post).toHaveBeenLastCalledWith("/agent/inbound/inbsrc_1/rotate");
  });

  it("checks a sample request against settings or a saved source", async () => {
    const { http, inbound } = setup();
    http.post.mockResolvedValue({ verified: false, reason: "Signature does not match" });
    const result = await inbound.checkSignature("agent", {
      signature: { secret: "s", header: "X-Sig", secretEncoding: "base64" }, headers: { "X-Sig": "00" }, body: "{}",
    });
    expect(result).toEqual({ verified: false, reason: "Signature does not match" });
    expect(http.post).toHaveBeenLastCalledWith("/agent/inbound/signature-check", {
      headers: { "X-Sig": "00" }, body: "{}", signature: { secret: "s", header: "X-Sig", secret_encoding: "base64" },
    });
    await inbound.checkSignature("agent", { sourceId: "inbsrc_1", headers: {}, body: new Uint8Array([255]) });
    expect(http.post).toHaveBeenLastCalledWith("/agent/inbound/signature-check", {
      headers: {}, body: "/w==", body_encoding: "base64", source_id: "inbsrc_1",
    });
  });

  it("lists, gets, replays and reports events", async () => {
    const { http, inbound } = setup();
    http.get.mockResolvedValueOnce({ events: [EVENT], next_cursor: "next" });
    const page = await inbound.listEvents("agent", "inbsrc_1", { limit: 10, cursor: "c" });
    expect(page).toMatchObject({ nextCursor: "next", events: [{ sourceId: "inbsrc_1", status: "failed", request: null }] });
    expect(http.get).toHaveBeenLastCalledWith("/agent/inbound/inbsrc_1/events", { limit: 10, cursor: "c" });

    http.get.mockResolvedValueOnce({ ...EVENT, request: REQUEST });
    expect((await inbound.getEvent("agent", "inbsrc_1", "inbev_1")).request?.body_encoding).toBe("utf8");
    expect(http.get).toHaveBeenLastCalledWith("/agent/inbound/inbsrc_1/events/inbev_1");

    http.post.mockResolvedValueOnce({ ...EVENT, status: "pending" });
    expect((await inbound.replayEvent("agent", "inbsrc_1", "inbev_1")).status).toBe("pending");
    expect(http.post).toHaveBeenLastCalledWith("/agent/inbound/inbsrc_1/events/inbev_1/replay");

    http.post.mockResolvedValueOnce(undefined);
    await inbound.reportInboundEventResult("agent", "inbsrc_1", "inbev_1", { status: "failed", error: "exit 1", deliveryId: "inbdel_1" });
    expect(http.post).toHaveBeenLastCalledWith("/agent/inbound/inbsrc_1/events/inbev_1/result", { status: "failed", error: "exit 1", delivery_id: "inbdel_1" });
  });

  it("is exposed on the client", () => {
    expect(new Inkbox({ apiKey: "ak_test_example" }).inbound).toBeInstanceOf(InboundResource);
  });
});

describe("hosting agent URL and ports", () => {
  it("reads url from hosting", async () => {
    const http = { get: vi.fn().mockResolvedValue({ mode: "inkbox", identity_id: "identity", url: "https://agent.example.test", delivery: "internal" }) };
    const resource = new IdentitiesResource(http as unknown as HttpTransport);
    expect(await resource.getHosting("agent")).toMatchObject({ url: "https://agent.example.test", delivery: "internal" });
    http.get.mockResolvedValueOnce({ mode: "external", identity_id: "identity" });
    expect(await resource.getHosting("agent")).toMatchObject({ url: null, delivery: "tunnel" });
  });

  it("gets, updates and rotates ports", async () => {
    const wire = {
      url: "https://agent.example.test", default_port: 3000, version: 4,
      ports: [
        { port: 3000, public: false, url: "https://agent.example.test", token_url: "https://agent.example.test?_token=t" },
        { port: 8080, public: true, url: null, token_url: null },
      ],
    };
    const http = { get: vi.fn().mockResolvedValue(wire), patch: vi.fn().mockResolvedValue(wire), post: vi.fn().mockResolvedValue(wire) };
    const resource = new IdentitiesResource(http as unknown as HttpTransport);
    expect(await resource.getHostingPorts("@agent")).toEqual({
      url: wire.url, defaultPort: 3000, version: 4,
      ports: [
        { port: 3000, public: false, url: wire.url, tokenUrl: wire.ports[0].token_url },
        { port: 8080, public: true, url: null, tokenUrl: null },
      ],
    });
    expect(http.get).toHaveBeenCalledWith("/%40agent/hosting/ports");
    await resource.updateHostingPorts("agent", { version: 4, defaultPort: null, ports: [{ port: 8080, public: true }] });
    expect(http.patch).toHaveBeenCalledWith("/agent/hosting/ports", { version: 4, default_port: null, ports: [{ port: 8080, public: true }] });
    await resource.updateHostingPorts("agent", { version: 4, defaultPort: 8080 });
    expect(http.patch.mock.calls[1][1]).toEqual({ version: 4, default_port: 8080 });
    await resource.rotateHostingPortToken("agent", 3000);
    expect(http.post).toHaveBeenCalledWith("/agent/hosting/ports/3000/token", {});
  });

  it("creates a tunnel for an existing identity", async () => {
    const http = { post: vi.fn().mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001", organization_id: "org_example", tunnel_name: "agent",
      agent_identity_id: "00000000-0000-0000-0000-000000000000", tls_mode: "edge", cert_pem: null,
      cert_fingerprint_sha256: null, cert_expires_at: null, status: "active", last_connected_at: null,
      last_connected_ip_addr: null, last_disconnected_at: null, currently_connected: false,
      public_host: "agent.example.test", zone: "example.test", metadata: {},
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    }) };
    const resource = new IdentitiesResource(http as unknown as HttpTransport);
    const tunnel = await resource.createTunnel("@agent");
    expect(http.post).toHaveBeenCalledWith("/%40agent/tunnel", {});
    expect([tunnel.tunnelName, tunnel.publicHost]).toEqual(["agent", "agent.example.test"]);
  });

  it("sends hosted on identity create", async () => {
    const http = { post: vi.fn().mockRejectedValue(new Error("stop")) };
    const resource = new IdentitiesResource(http as unknown as HttpTransport);
    await expect(resource.create({ agentHandle: "agent", hosted: true })).rejects.toThrow();
    expect(http.post.mock.calls[0][1]).toEqual({ agent_handle: "agent", hosted: true });
  });
});
