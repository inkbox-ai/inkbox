import { describe, expect, it, vi } from "vitest";
import type { HttpTransport } from "../src/_http.js";
import { InboundResource, Inkbox } from "../src/index.js";
import { IdentitiesResource } from "../src/identities/resources/identities.js";

const SOURCE = {
  id: "inbsrc_1", name: "payments", url: "https://agent.example.test/inbound/token",
  signature: { scheme: "hmac", header: "x-signature", algorithm: "sha256", encoding: "hex", prefix: "sha256=" },
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
    const signature = { scheme: "stripe" as const, secret: "synthetic-secret" };
    const source = await inbound.createSource("@agent/x", { name: "payments", handler: { type: "script", command: "./run.sh" }, signature });
    expect(source).toMatchObject({ id: "inbsrc_1", createdAt: SOURCE.created_at, signature: { scheme: "hmac" } });
    expect(http.post).toHaveBeenCalledWith("/%40agent%2Fx/inbound", { name: "payments", signature, handler: { type: "script", command: "./run.sh" } });

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
    await inbound.reportInboundEventResult("agent", "inbsrc_1", "inbev_1", { status: "failed", error: "exit 1" });
    expect(http.post).toHaveBeenLastCalledWith("/agent/inbound/inbsrc_1/events/inbev_1/result", { status: "failed", error: "exit 1" });
  });

  it("is exposed on the client", () => {
    expect(new Inkbox({ apiKey: "ak_test_example" }).inbound).toBeInstanceOf(InboundResource);
  });
});

describe("hosting agent URL and ports", () => {
  it("reads url from hosting", async () => {
    const http = { get: vi.fn().mockResolvedValue({ mode: "inkbox", identity_id: "identity", url: "https://agent.example.test" }) };
    const resource = new IdentitiesResource(http as unknown as HttpTransport);
    expect((await resource.getHosting("agent")).url).toBe("https://agent.example.test");
    http.get.mockResolvedValueOnce({ mode: "external", identity_id: "identity" });
    expect((await resource.getHosting("agent")).url).toBeNull();
  });

  it("gets, updates and rotates ports", async () => {
    const wire = {
      url: "https://agent.example.test", default_port: 3000,
      ports: [
        { port: 3000, public: false, url: "https://agent.example.test", token_url: "https://agent.example.test?_token=t" },
        { port: 8080, public: true, url: null, token_url: null },
      ],
    };
    const http = { get: vi.fn().mockResolvedValue(wire), patch: vi.fn().mockResolvedValue(wire), post: vi.fn().mockResolvedValue(wire) };
    const resource = new IdentitiesResource(http as unknown as HttpTransport);
    expect(await resource.getHostingPorts("@agent")).toEqual({
      url: wire.url, defaultPort: 3000,
      ports: [
        { port: 3000, public: false, url: wire.url, tokenUrl: wire.ports[0].token_url },
        { port: 8080, public: true, url: null, tokenUrl: null },
      ],
    });
    expect(http.get).toHaveBeenCalledWith("/%40agent/hosting/ports");
    await resource.updateHostingPorts("agent", { defaultPort: null, ports: [{ port: 8080, public: true }] });
    expect(http.patch).toHaveBeenCalledWith("/agent/hosting/ports", { default_port: null, ports: [{ port: 8080, public: true }] });
    await resource.updateHostingPorts("agent", { defaultPort: 8080 });
    expect(http.patch.mock.calls[1][1]).toEqual({ default_port: 8080 });
    await resource.rotateHostingPortToken("agent", 3000);
    expect(http.post).toHaveBeenCalledWith("/agent/hosting/ports/3000/token", {});
  });

  it("sends hosted on identity create", async () => {
    const http = { post: vi.fn().mockRejectedValue(new Error("stop")) };
    const resource = new IdentitiesResource(http as unknown as HttpTransport);
    await expect(resource.create({ agentHandle: "agent", hosted: true })).rejects.toThrow();
    expect(http.post.mock.calls[0][1]).toEqual({ agent_handle: "agent", hosted: true });
  });
});
