// sdk/typescript/tests/phone/incomingCallAction.test.ts
import { describe, it, expect, vi } from "vitest";
import { IncomingCallActionResource } from "../../src/phone/resources/incomingCallAction.js";
import { IncomingCallAction } from "../../src/phone/types.js";
import type { HttpTransport } from "../../src/_http.js";
import { RAW_INCOMING_CALL_ACTION_CONFIG } from "../sampleData.js";

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

describe("IncomingCallActionResource.get", () => {
  it("fetches config with no identity scope", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_INCOMING_CALL_ACTION_CONFIG);
    const res = new IncomingCallActionResource(http);

    const config = await res.get();

    expect(http.get).toHaveBeenCalledWith("/incoming-call-action", {});
    expect(config.incomingCallAction).toBe(IncomingCallAction.WEBHOOK);
    expect(config.agentIdentityId).toBe(IDENTITY_ID);
    expect(config.clientWebsocketUrl).toBeNull();
    expect(config.incomingCallWebhookUrl).toBe("https://agent.example.com/incoming-call");
  });

  it("scopes by agentIdentityId when provided", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_INCOMING_CALL_ACTION_CONFIG);
    const res = new IncomingCallActionResource(http);

    await res.get({ agentIdentityId: IDENTITY_ID });

    expect(http.get).toHaveBeenCalledWith("/incoming-call-action", {
      agent_identity_id: IDENTITY_ID,
    });
  });

  it("maps snake_case fields to camelCase when all are set", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue({
      agent_identity_id: IDENTITY_ID,
      incoming_call_action: "auto_accept",
      client_websocket_url: "wss://agent.example.com/ws",
      incoming_call_webhook_url: "https://agent.example.com/incoming-call",
    });
    const res = new IncomingCallActionResource(http);

    const config = await res.get();

    expect(config).toEqual({
      agentIdentityId: IDENTITY_ID,
      incomingCallAction: IncomingCallAction.AUTO_ACCEPT,
      clientWebsocketUrl: "wss://agent.example.com/ws",
      incomingCallWebhookUrl: "https://agent.example.com/incoming-call",
    });
  });
});

describe("IncomingCallActionResource.set", () => {
  it("sends the required action only", async () => {
    const http = mockHttp();
    vi.mocked(http.put).mockResolvedValue(RAW_INCOMING_CALL_ACTION_CONFIG);
    const res = new IncomingCallActionResource(http);

    await res.set({ incomingCallAction: IncomingCallAction.AUTO_REJECT });

    expect(http.put).toHaveBeenCalledWith("/incoming-call-action", {
      incoming_call_action: "auto_reject",
    });
  });

  it("includes optional fields when provided", async () => {
    const http = mockHttp();
    vi.mocked(http.put).mockResolvedValue(RAW_INCOMING_CALL_ACTION_CONFIG);
    const res = new IncomingCallActionResource(http);

    await res.set({
      incomingCallAction: IncomingCallAction.WEBHOOK,
      agentIdentityId: IDENTITY_ID,
      clientWebsocketUrl: "wss://agent.example.com/ws",
      incomingCallWebhookUrl: "https://agent.example.com/incoming-call",
    });

    expect(http.put).toHaveBeenCalledWith("/incoming-call-action", {
      incoming_call_action: "webhook",
      agent_identity_id: IDENTITY_ID,
      client_websocket_url: "wss://agent.example.com/ws",
      incoming_call_webhook_url: "https://agent.example.com/incoming-call",
    });
  });

  it("parses the returned config to camelCase", async () => {
    const http = mockHttp();
    vi.mocked(http.put).mockResolvedValue(RAW_INCOMING_CALL_ACTION_CONFIG);
    const res = new IncomingCallActionResource(http);

    const config = await res.set({ incomingCallAction: IncomingCallAction.WEBHOOK });

    expect(config.agentIdentityId).toBe(IDENTITY_ID);
    expect(config.incomingCallAction).toBe(IncomingCallAction.WEBHOOK);
    expect(config.clientWebsocketUrl).toBeNull();
    expect(config.incomingCallWebhookUrl).toBe("https://agent.example.com/incoming-call");
  });
});
