// sdk/typescript/tests/phone/hostedRealtime.test.ts
import { describe, it, expect, vi } from "vitest";
import { HostedRealtimeResource } from "../../src/phone/resources/hostedRealtime.js";
import type { HttpTransport } from "../../src/_http.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const IDENTITY_ID = "eeee5555-0000-0000-0000-000000000001";

const RAW_CONFIG = {
  agent_identity_id: IDENTITY_ID,
  enabled: true,
  voice: "warm",
  model: "realtime-standard",
  instructions: "Be concise.",
};

describe("HostedRealtimeResource.getConfig", () => {
  it("fetches config with no identity scope", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_CONFIG);
    const res = new HostedRealtimeResource(http);

    const config = await res.getConfig();

    expect(http.get).toHaveBeenCalledWith("/hosted-realtime-config", {});
    expect(config.agentIdentityId).toBe(IDENTITY_ID);
    expect(config.enabled).toBe(true);
    expect(config.voice).toBe("warm");
    expect(config.model).toBe("realtime-standard");
    expect(config.instructions).toBe("Be concise.");
  });

  it("scopes by agentIdentityId when provided", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_CONFIG);
    const res = new HostedRealtimeResource(http);

    await res.getConfig({ agentIdentityId: IDENTITY_ID });

    expect(http.get).toHaveBeenCalledWith("/hosted-realtime-config", {
      agent_identity_id: IDENTITY_ID,
    });
  });

  it("normalizes missing optionals to null", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue({
      agent_identity_id: IDENTITY_ID,
      enabled: false,
    });
    const res = new HostedRealtimeResource(http);

    const config = await res.getConfig();

    expect(config.enabled).toBe(false);
    expect(config.voice).toBeNull();
    expect(config.model).toBeNull();
    expect(config.instructions).toBeNull();
  });
});

describe("HostedRealtimeResource.setConfig", () => {
  it("sends only enabled when optionals are omitted", async () => {
    const http = mockHttp();
    vi.mocked(http.put).mockResolvedValue(RAW_CONFIG);
    const res = new HostedRealtimeResource(http);

    await res.setConfig({ enabled: true });

    expect(http.put).toHaveBeenCalledWith("/hosted-realtime-config", {
      enabled: true,
    });
  });

  it("sends the full body when all fields are provided", async () => {
    const http = mockHttp();
    vi.mocked(http.put).mockResolvedValue(RAW_CONFIG);
    const res = new HostedRealtimeResource(http);

    const config = await res.setConfig({
      enabled: true,
      voice: "warm",
      model: "realtime-standard",
      instructions: "Be concise.",
      agentIdentityId: IDENTITY_ID,
    });

    expect(http.put).toHaveBeenCalledWith("/hosted-realtime-config", {
      enabled: true,
      agent_identity_id: IDENTITY_ID,
      voice: "warm",
      model: "realtime-standard",
      instructions: "Be concise.",
    });
    expect(config.enabled).toBe(true);
  });
});
