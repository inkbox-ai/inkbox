// sdk/typescript/tests/phone/calls.test.ts
import { describe, it, expect, vi } from "vitest";
import { CallsResource } from "../../src/phone/resources/calls.js";
import { CallOrigin } from "../../src/phone/types.js";
import type { HttpTransport } from "../../src/_http.js";
import {
  RAW_PHONE_CALL,
  RAW_PHONE_CALL_BLOCKED,
  RAW_PHONE_CALL_WITH_RATE_LIMIT,
  RAW_PHONE_TRANSCRIPT,
} from "../sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const IDENTITY_ID = "eeee5555-0000-0000-0000-000000000001";
const CALL_ID = "bbbb2222-0000-0000-0000-000000000001";

describe("CallsResource.list", () => {
  it("uses default limit and offset with no identity scope", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_PHONE_CALL]);
    const res = new CallsResource(http);

    const calls = await res.list();

    expect(http.get).toHaveBeenCalledWith("/calls", { limit: 50, offset: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].direction).toBe("outbound");
  });

  it("scopes by agentIdentityId when provided", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new CallsResource(http);

    await res.list({ agentIdentityId: IDENTITY_ID, limit: 10, offset: 20 });

    expect(http.get).toHaveBeenCalledWith("/calls", {
      limit: 10,
      offset: 20,
      agent_identity_id: IDENTITY_ID,
    });
  });

  it("omits is_blocked when not provided", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new CallsResource(http);

    await res.list();

    expect(http.get).toHaveBeenCalledWith("/calls", { limit: 50, offset: 0 });
  });

  it("forwards isBlocked=true for the admin-side blocked listing", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_PHONE_CALL_BLOCKED]);
    const res = new CallsResource(http);

    const calls = await res.list({ isBlocked: true });

    expect(http.get).toHaveBeenCalledWith("/calls", {
      limit: 50,
      offset: 0,
      is_blocked: true,
    });
    expect(calls[0].isBlocked).toBe(true);
  });

  it("forwards isBlocked=false to narrow admin/JWT view to non-blocked rows", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_PHONE_CALL]);
    const res = new CallsResource(http);

    const calls = await res.list({ isBlocked: false });

    expect(http.get).toHaveBeenCalledWith("/calls", {
      limit: 50,
      offset: 0,
      is_blocked: false,
    });
    expect(calls[0].isBlocked).toBe(false);
  });

  it("defaults isBlocked to false when missing from server response (back-compat)", async () => {
    const http = mockHttp();
    // Older server payload without the field — parser must default to false.
    const { is_blocked: _ignored, ...legacyPayload } = RAW_PHONE_CALL;
    void _ignored;
    vi.mocked(http.get).mockResolvedValue([legacyPayload]);
    const res = new CallsResource(http);

    const calls = await res.list();

    expect(calls[0].isBlocked).toBe(false);
  });

  it("defaults origin to dedicated_number when missing (back-compat)", async () => {
    const http = mockHttp();
    const { origin: _ignored, ...legacyPayload } = RAW_PHONE_CALL;
    void _ignored;
    vi.mocked(http.get).mockResolvedValue([legacyPayload]);
    const res = new CallsResource(http);

    const calls = await res.list();

    expect(calls[0].origin).toBe(CallOrigin.DEDICATED_NUMBER);
  });
});

describe("CallsResource.get", () => {
  it("fetches by ID", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_PHONE_CALL);
    const res = new CallsResource(http);

    const call = await res.get(CALL_ID);

    expect(http.get).toHaveBeenCalledWith(`/calls/${CALL_ID}`);
    expect(call.status).toBe("completed");
  });
});

describe("CallsResource.transcripts", () => {
  it("returns transcript segments for a call", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_PHONE_TRANSCRIPT]);
    const res = new CallsResource(http);

    const transcripts = await res.transcripts(CALL_ID);

    expect(http.get).toHaveBeenCalledWith(`/calls/${CALL_ID}/transcripts`);
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0].text).toBe("Hello, how can I help you?");
    expect(transcripts[0].seq).toBe(0);
  });

  it("returns empty array", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new CallsResource(http);
    expect(await res.transcripts(CALL_ID)).toEqual([]);
  });
});

describe("CallsResource.place", () => {
  it("places call with required fields (defaults origination to dedicated)", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_PHONE_CALL_WITH_RATE_LIMIT);
    const res = new CallsResource(http);

    const call = await res.place({
      fromNumber: "+18335794607",
      toNumber: "+15551234567",
    });

    expect(http.post).toHaveBeenCalledWith("/place-call", {
      from_number: "+18335794607",
      to_number: "+15551234567",
      origination: "dedicated_number",
    });
    expect(call.rateLimit.callsUsed).toBe(5);
  });

  it("sends shared origination with agent_identity_id, no from_number", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_PHONE_CALL_WITH_RATE_LIMIT);
    const res = new CallsResource(http);

    await res.place({
      toNumber: "+15551234567",
      origination: CallOrigin.SHARED_IMESSAGE_NUMBER,
      agentIdentityId: IDENTITY_ID,
    });

    expect(http.post).toHaveBeenCalledWith("/place-call", {
      to_number: "+15551234567",
      origination: "shared_imessage_number",
      agent_identity_id: IDENTITY_ID,
    });
  });

  it("includes optional fields when provided", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_PHONE_CALL_WITH_RATE_LIMIT);
    const res = new CallsResource(http);

    await res.place({
      fromNumber: "+18335794607",
      toNumber: "+15551234567",
      clientWebsocketUrl: "wss://agent.example.com/ws",
    });

    const [, body] = vi.mocked(http.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["client_websocket_url"]).toBe("wss://agent.example.com/ws");
  });

  it("omits optional fields when not provided", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_PHONE_CALL_WITH_RATE_LIMIT);
    const res = new CallsResource(http);

    await res.place({ fromNumber: "+18335794607", toNumber: "+15551234567" });

    const [, body] = vi.mocked(http.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["client_websocket_url"]).toBeUndefined();
    expect(body["agent_identity_id"]).toBeUndefined();
  });
});
