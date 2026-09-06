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

describe("HostedAgentConfigResource.listVoices", () => {
  it("fetches the organization catalog and preserves all voices and preview states", async () => {
    const http = mockHttp();
    const voice = { id: "future-voice", name: "Future Voice", description: "Warm", available: true };
    vi.mocked(http.get).mockResolvedValue({
      voices: [
        { ...voice, preview_url: "https://example.com/voice.wav" },
        { ...voice, id: "unavailable-voice", available: false, preview_url: null },
        { ...voice, id: "no-preview" },
      ],
      default_voice: "future-default",
    });

    const catalog: HostedAgentVoiceCatalog = await new HostedAgentConfigResource(http).listVoices();
    const first: HostedAgentVoiceOption = catalog.voices[0];

    expect(http.get).toHaveBeenCalledExactlyOnceWith("/hosted-agent-voices");
    expect(catalog.defaultVoice).toBe("future-default");
    expect(first).toEqual({ ...voice, previewUrl: "https://example.com/voice.wav" });
    expect(catalog.voices.slice(1)).toEqual([
      { ...voice, id: "unavailable-voice", available: false, previewUrl: null },
      { ...voice, id: "no-preview", previewUrl: null },
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
