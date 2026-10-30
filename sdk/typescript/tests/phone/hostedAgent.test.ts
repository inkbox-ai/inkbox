// sdk/typescript/tests/phone/hostedAgent.test.ts
import { describe, it, expect, vi } from "vitest";
import { HostedAgentConfigResource } from "../../src/phone/resources/hostedAgent.js";
import {
  CallMode,
  HostedAgentAuthorityMode,
} from "../../src/phone/types.js";
import type { HttpTransport } from "../../src/_http.js";
import type { HostedAgentVoiceCatalog, HostedAgentVoiceOption } from "../../src/index.js";
import { RAW_HOSTED_AGENT_CONFIG } from "../sampleData.js";

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

describe("MCP connection grants", () => {
  it("preserves automatic context mode on requests and responses", async () => {
    const http = mockHttp();
    const resource = new HostedAgentConfigResource(http);
    vi.mocked(http.post).mockResolvedValue({ id: IDENTITY_ID, agent_identity_id: IDENTITY_ID,
      label: "Calendar", url: "https://calendar.example/mcp", transport: "streamable_http",
      auth: { type: "none", configured: false }, context: { mode: "all" }, allowed_tools: null });
    const connection = await resource.createMcpServer({ label: "Calendar", url: "https://calendar.example/mcp",
      allowedTools: null, context: { mode: "all" } }, { idempotencyKey: "automatic-context" });
    expect(connection.context.mode).toBe("all");
    expect(JSON.parse(JSON.stringify(vi.mocked(http.post).mock.calls[0][1])).context).toEqual({ mode: "all" });
  });
  it("serializes OAuth settings and parses browser authorization status", async () => {
    const http = mockHttp();
    const resource = new HostedAgentConfigResource(http);
    vi.mocked(http.post).mockResolvedValue({ id: IDENTITY_ID, agent_identity_id: IDENTITY_ID,
      label: "Calendar", url: "https://calendar.example/mcp", transport: "streamable_http",
      auth: { type: "oauth", configured: false, status: "authorization_required", requested_scopes: ["read"] },
      enabled: true, allowed_tools: null, context: {}, config_version: 1, preparation_status: "pending" });
    const connection = await resource.createMcpServer({ label: "Calendar", url: "https://calendar.example/mcp",
      auth: { type: "oauth", clientId: "client", clientSecret: "synthetic-secret", tokenEndpointAuthMethod: "client_secret_basic", scopes: ["read"] },
    }, { idempotencyKey: "create" });
    expect(JSON.parse(JSON.stringify(vi.mocked(http.post).mock.calls[0][1])).auth).toEqual({
      type: "oauth", client_id: "client", client_secret: "synthetic-secret", token_endpoint_auth_method: "client_secret_basic", scopes: ["read"],
    });
    expect(connection.auth.requestedScopes).toEqual(["read"]);
    expect(JSON.stringify(connection)).not.toContain("synthetic-secret");
    const response = { id: IDENTITY_ID, connection_id: IDENTITY_ID, agent_identity_id: IDENTITY_ID, status: "pending",
      expires_at: "2026-10-27T20:00:00Z", connect_url: "https://inkbox.ai/console/mcp-connections/oauth/connect",
      config_version: null, requested_scopes: ["read"], error_code: null };
    vi.mocked(http.post).mockResolvedValue(response);
    const authorization = await resource.startMcpAuthorization(IDENTITY_ID, { expectedVersion: 1, idempotencyKey: "connect" });
    expect(authorization.expiresAt).toEqual(new Date(response.expires_at));
    expect(authorization.connectUrl).toEqual(response.connect_url);
    expect(http.post).toHaveBeenLastCalledWith(`/hosted-agent-config/mcp-servers/${IDENTITY_ID}/oauth/authorizations`,
      { expected_version: 1 }, { headers: { "Idempotency-Key": "connect" } });
    vi.mocked(http.get).mockResolvedValue({ ...response, status: "completed", connect_url: null });
    expect((await resource.getMcpAuthorization(IDENTITY_ID, IDENTITY_ID)).status).toBe("completed");
    await resource.cancelMcpAuthorization(IDENTITY_ID, IDENTITY_ID);
    expect(http.delete).toHaveBeenCalledWith(`/hosted-agent-config/mcp-servers/${IDENTITY_ID}/oauth/authorizations/${IDENTITY_ID}`);
    vi.mocked(http.post).mockResolvedValue({ success: true, code: "disconnected", config_version: 2 });
    expect(await resource.disconnectMcpServer(IDENTITY_ID, { expectedVersion: 2, idempotencyKey: "disconnect" }))
      .toEqual({ success: true, code: "disconnected", configVersion: 2 });
  });
  it("distinguishes omitted authentication and restrictions from explicit removal", async () => {
    const http = mockHttp();
    const resource = new HostedAgentConfigResource(http);
    const row = { id: IDENTITY_ID, agent_identity_id: IDENTITY_ID, label: "Calendar", url: "https://tools.example/mcp",
      transport: "streamable_http", auth: { type: "bearer", configured: true }, enabled: true,
      allowed_tools: null, context: {}, config_version: 2, preparation_status: "pending" };
    vi.mocked(http.patch).mockResolvedValue(row);
    await resource.updateMcpServer(IDENTITY_ID, { expectedVersion: 1, label: "Calendar" });
    const wire = JSON.parse(JSON.stringify(vi.mocked(http.patch).mock.calls[0][1]));
    expect(wire).toEqual({ expected_version: 1, label: "Calendar" });
    await resource.updateMcpServer(IDENTITY_ID, { expectedVersion: 2, auth: { type: "none" }, allowedTools: null });
    expect(JSON.parse(JSON.stringify(vi.mocked(http.patch).mock.calls[1][1]))).toEqual({ expected_version: 2, auth: { type: "none" }, allowed_tools: null });
    vi.mocked(http.post).mockResolvedValue(row);
    await resource.createMcpServer({ label: "Calendar", url: row.url,
      auth: { type: "header", headerName: "X-Example-Key", valuePrefix: "Token ", token: "synthetic" },
      context: { skills: [{ uri: "skill://guide/SKILL.md", manifestDigest: "a".repeat(64) }] },
    }, { idempotencyKey: "stable-create" });
    expect(http.post).toHaveBeenCalledWith("/hosted-agent-config/mcp-servers", expect.objectContaining({
      auth: { type: "header", header_name: "X-Example-Key", value_prefix: "Token ", token: "synthetic" },
      context: expect.objectContaining({ skills: [{ uri: "skill://guide/SKILL.md", manifest_digest: "a".repeat(64) }] }),
    }), { headers: { "Idempotency-Key": "stable-create" } });
  });
});

describe("HostedAgentConfigResource.listVoices", () => {
  it("fetches the organization catalog and preserves all voices and preview states", async () => {
    const http = mockHttp();
    const voice = { id: "future-voice", name: "Future Voice", description: "Warm", available: true };
    vi.mocked(http.get).mockResolvedValue({
      voices: [
        { ...voice, preview_url: "https://example.com/voice.wav", mcp_supported: true },
        { ...voice, id: "unavailable-voice", available: false, preview_url: null },
        { ...voice, id: "no-preview" },
      ],
      default_voice: "future-default",
    });

    const catalog: HostedAgentVoiceCatalog = await new HostedAgentConfigResource(http).listVoices();
    const first: HostedAgentVoiceOption = catalog.voices[0];

    expect(http.get).toHaveBeenCalledExactlyOnceWith("/hosted-agent-voices");
    expect(catalog.defaultVoice).toBe("future-default");
    expect(first).toEqual({ ...voice, previewUrl: "https://example.com/voice.wav", mcpSupported: true });
    expect(catalog.voices.slice(1)).toEqual([
      { ...voice, id: "unavailable-voice", available: false, previewUrl: null, mcpSupported: false },
      { ...voice, id: "no-preview", previewUrl: null, mcpSupported: false },
    ]);
  });

  it("retains the default when the catalog is empty", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue({ voices: [], default_voice: "future-default" });

    expect(await new HostedAgentConfigResource(http).listVoices()).toEqual({
      voices: [], defaultVoice: "future-default",
    });
  });

  it("propagates request failures instead of returning an empty catalog", async () => {
    const http = mockHttp();
    const error = new Error("Voice catalog request failed");
    vi.mocked(http.get).mockRejectedValue(error);

    await expect(new HostedAgentConfigResource(http).listVoices()).rejects.toBe(error);
  });
});

describe("HostedAgentConfigResource.getConfig", () => {
  it("fetches config with no identity scope", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_HOSTED_AGENT_CONFIG);
    const res = new HostedAgentConfigResource(http);

    const config = await res.getConfig();

    expect(http.get).toHaveBeenCalledWith("/hosted-agent-config", {});
    expect(config.agentIdentityId).toBe(IDENTITY_ID);
    expect(config.voice).toBe("warm-voice");
    expect(config.model).toBe("fast-model");
    expect(config.effectiveVoice).toBe("warm-voice");
    expect(config.effectiveModel).toBe("fast-model");
    expect(config.instructions).toBe(
      "Always offer to text a summary after the call.",
    );
    expect(config.authorityMode).toBe(HostedAgentAuthorityMode.CONTACT_SCOPED);
  });

  it("scopes by agentIdentityId when provided", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_HOSTED_AGENT_CONFIG);
    const res = new HostedAgentConfigResource(http);

    await res.getConfig({ agentIdentityId: IDENTITY_ID });

    expect(http.get).toHaveBeenCalledWith("/hosted-agent-config", {
      agent_identity_id: IDENTITY_ID,
    });
  });

  it("parses an all-null (never configured) config", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue({
      agent_identity_id: IDENTITY_ID,
      voice: null,
      model: null,
      instructions: null,
    });
    const res = new HostedAgentConfigResource(http);

    const config = await res.getConfig();

    expect(config.voice).toBeNull();
    expect(config.model).toBeNull();
    expect(config.instructions).toBeNull();
  });
});

describe("HostedAgentConfigResource.setConfig", () => {
  it("accepts but omits the deprecated model option", async () => {
    const http = mockHttp();
    vi.mocked(http.put).mockResolvedValue(RAW_HOSTED_AGENT_CONFIG);
    const res = new HostedAgentConfigResource(http);

    const config = await res.setConfig({
      voice: "warm-voice",
      model: "fast-model",
      instructions: "Always offer to text a summary after the call.",
      agentIdentityId: IDENTITY_ID,
    });

    expect(http.put).toHaveBeenCalledWith("/hosted-agent-config", {
      agent_identity_id: IDENTITY_ID,
      voice: "warm-voice",
      instructions: "Always offer to text a summary after the call.",
    });
    expect(config.voice).toBe("warm-voice");
  });

  it("sends an empty body to reset everything to server defaults", async () => {
    const http = mockHttp();
    vi.mocked(http.put).mockResolvedValue({
      agent_identity_id: IDENTITY_ID,
      voice: null,
      model: null,
      instructions: null,
    });
    const res = new HostedAgentConfigResource(http);

    const config = await res.setConfig();

    // Full-replace PUT: omitted fields reset to server defaults.
    expect(http.put).toHaveBeenCalledWith("/hosted-agent-config", {});
    expect(config.voice).toBeNull();
  });

  it("sends only the set field on a partial call (full-replace semantics)", async () => {
    const http = mockHttp();
    vi.mocked(http.put).mockResolvedValue({
      ...RAW_HOSTED_AGENT_CONFIG,
      model: null,
      instructions: null,
    });
    const res = new HostedAgentConfigResource(http);

    await res.setConfig({ voice: "warm-voice" });

    expect(http.put).toHaveBeenCalledWith("/hosted-agent-config", {
      voice: "warm-voice",
    });
  });

  it("round-trips: setConfig and getConfig parse the same shape", async () => {
    const http = mockHttp();
    vi.mocked(http.put).mockResolvedValue(RAW_HOSTED_AGENT_CONFIG);
    vi.mocked(http.get).mockResolvedValue(RAW_HOSTED_AGENT_CONFIG);
    const res = new HostedAgentConfigResource(http);

    const setResult = await res.setConfig({
      voice: "warm-voice",
      model: "fast-model",
      instructions: "Always offer to text a summary after the call.",
    });
    const getResult = await res.getConfig();

    expect(setResult).toEqual(getResult);
  });
});

describe("HostedAgentConfigResource.setAuthorityMode", () => {
  it("sends the exact body", async () => {
    const http = mockHttp();
    vi.mocked(http.put).mockResolvedValue({
      ...RAW_HOSTED_AGENT_CONFIG,
      authority_mode: "yolo",
    });
    const res = new HostedAgentConfigResource(http);

    const config = await res.setAuthorityMode({
      agentIdentityId: IDENTITY_ID,
      authorityMode: HostedAgentAuthorityMode.YOLO,
    });

    expect(http.put).toHaveBeenCalledWith(
      "/hosted-agent-config/authority-mode",
      {
        agent_identity_id: IDENTITY_ID,
        authority_mode: "yolo",
      },
    );
    expect(config.authorityMode).toBe(HostedAgentAuthorityMode.YOLO);
  });
});

describe("CallMode enum", () => {
  it("carries the exact wire strings", () => {
    expect(CallMode.CLIENT_WEBSOCKET).toBe("client_websocket");
    expect(CallMode.HOSTED_AGENT).toBe("hosted_agent");
  });
});

describe("HostedAgentAuthorityMode enum", () => {
  it("carries the exact wire strings", () => {
    expect(HostedAgentAuthorityMode.CONTACT_SCOPED).toBe("contact_scoped");
    expect(HostedAgentAuthorityMode.YOLO).toBe("yolo");
  });
});
