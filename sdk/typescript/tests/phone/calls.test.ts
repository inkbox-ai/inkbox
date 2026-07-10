// sdk/typescript/tests/phone/calls.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CallsResource } from "../../src/phone/resources/calls.js";
import { CallMode, CallOrigin } from "../../src/phone/types.js";
import { HttpTransport, InkboxAPIError } from "../../src/_http.js";
import {
  RAW_PHONE_CALL,
  RAW_PHONE_CALL_BLOCKED,
  RAW_PHONE_CALL_WITH_RATE_LIMIT,
  RAW_PHONE_TRANSCRIPT,
  RAW_POST_CALL_ACTION,
  RAW_POST_CALL_ACTION_CANCELED,
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

  it("parses PhoneCall rows to camelCase", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_PHONE_CALL]);
    const res = new CallsResource(http);

    const [call] = await res.list();

    expect(call.localPhoneNumber).toBe("+18335794607");
    expect(call.remotePhoneNumber).toBe("+15551234567");
    expect(call.clientWebsocketUrl).toBe("wss://agent.example.com/ws");
    expect(call.startedAt).toBeInstanceOf(Date);
    expect(call.createdAt).toBeInstanceOf(Date);
  });

  it("passes shared-pool rows through with null localPhoneNumber", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([
      { ...RAW_PHONE_CALL, local_phone_number: null, origin: "shared_imessage_number" },
    ]);
    const res = new CallsResource(http);

    const [call] = await res.list();

    expect(call.localPhoneNumber).toBeNull();
    expect(call.origin).toBe(CallOrigin.SHARED_IMESSAGE_NUMBER);
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

describe("CallsResource.hangup", () => {
  it("posts the hangup and returns the call", async () => {
    const http = mockHttp();
    // Teardown is async at the carrier: the row can come back still live.
    vi.mocked(http.post).mockResolvedValue({
      ...RAW_PHONE_CALL,
      status: "answered",
      hangup_reason: "local",
      ended_at: null,
    });
    const res = new CallsResource(http);

    const call = await res.hangup(CALL_ID);

    expect(http.post).toHaveBeenCalledWith(`/calls/${CALL_ID}/hangup`);
    expect(call.status).toBe("answered");
    expect(call.hangupReason).toBe("local");
    expect(call.endedAt).toBeNull();
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
      mode: "client_websocket",
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
      mode: "client_websocket",
      agent_identity_id: IDENTITY_ID,
    });
    // The from_number key must not be present at all on shared bodies.
    const [, body] = vi.mocked(http.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty("from_number");
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
    // reason only rides hosted placements; mode is always on the wire.
    expect(body["reason"]).toBeUndefined();
    expect(body["mode"]).toBe("client_websocket");
  });

  it("parses the response including origin and rateLimit", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({
      ...RAW_PHONE_CALL_WITH_RATE_LIMIT,
      local_phone_number: null,
      origin: "shared_imessage_number",
    });
    const res = new CallsResource(http);

    const call = await res.place({
      toNumber: "+15551234567",
      origination: CallOrigin.SHARED_IMESSAGE_NUMBER,
      agentIdentityId: IDENTITY_ID,
    });

    expect(call.origin).toBe(CallOrigin.SHARED_IMESSAGE_NUMBER);
    expect(call.localPhoneNumber).toBeNull();
    expect(call.rateLimit).toEqual({
      callsUsed: 5,
      callsRemaining: 95,
      callsLimit: 100,
      minutesUsed: 12.5,
      minutesRemaining: 987.5,
      minutesLimit: 1000,
    });
  });
});

describe("CallsResource.place hosted mode", () => {
  it("sends mode=hosted_agent with the reason brief", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({
      ...RAW_PHONE_CALL_WITH_RATE_LIMIT,
      mode: "hosted_agent",
      reason: "Book a cleaning next week, mornings preferred",
    });
    const res = new CallsResource(http);

    const call = await res.place({
      toNumber: "+15551234567",
      fromNumber: "+18335794607",
      mode: CallMode.HOSTED_AGENT,
      reason: "Book a cleaning next week, mornings preferred",
    });

    expect(http.post).toHaveBeenCalledWith("/place-call", {
      to_number: "+15551234567",
      origination: "dedicated_number",
      mode: "hosted_agent",
      from_number: "+18335794607",
      reason: "Book a cleaning next week, mornings preferred",
    });
    expect(call.mode).toBe("hosted_agent");
    expect(call.reason).toBe("Book a cleaning next week, mornings preferred");
  });

  it("forwards a hosted call with ws-url instead of client-gating (server 422s)", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_PHONE_CALL_WITH_RATE_LIMIT);
    const res = new CallsResource(http);

    await res.place({
      toNumber: "+15551234567",
      clientWebsocketUrl: "wss://agent.example.com/ws",
      mode: CallMode.HOSTED_AGENT,
      reason: "Confirm the appointment",
    });

    const [, body] = vi.mocked(http.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["client_websocket_url"]).toBe("wss://agent.example.com/ws");
    expect(body["mode"]).toBe("hosted_agent");
  });

  it("defaults mode to client_websocket when missing from response (back-compat)", async () => {
    const http = mockHttp();
    const { mode: _m, reason: _r, ...legacy } = RAW_PHONE_CALL_WITH_RATE_LIMIT as Record<string, unknown> & { mode?: unknown; reason?: unknown };
    void _m; void _r;
    vi.mocked(http.post).mockResolvedValue(legacy);
    const res = new CallsResource(http);

    const call = await res.place({ toNumber: "+15551234567", fromNumber: "+18335794607" });

    expect(call.mode).toBe(CallMode.CLIENT_WEBSOCKET);
    expect(call.reason).toBeNull();
  });
});

describe("CallsResource.postCallActions", () => {
  it("returns actions in seq order, including canceled audit rows", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([
      RAW_POST_CALL_ACTION,
      RAW_POST_CALL_ACTION_CANCELED,
    ]);
    const res = new CallsResource(http);

    const actions = await res.postCallActions(CALL_ID);

    expect(http.get).toHaveBeenCalledWith(`/calls/${CALL_ID}/post-call-actions`);
    expect(actions).toHaveLength(2);
    expect(actions[0].seq).toBe(1);
    expect(actions[0].action).toBe("Book cleaning Tue 9:30am");
    expect(actions[0].status).toBe("open");
    expect(actions[0].callId).toBe(CALL_ID);
    expect(actions[0].createdAt).toBeInstanceOf(Date);
    expect(actions[1].status).toBe("canceled");
    expect(actions[1].details).toBeNull();
  });

  it("returns empty array for calls without hosted actions", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new CallsResource(http);
    expect(await res.postCallActions(CALL_ID)).toEqual([]);
  });
});

describe("CallsResource.place API errors", () => {
  // Exercise the real transport so status/detail propagation is covered.
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeErrorResponse(status: number, body: unknown) {
    return {
      ok: false,
      status,
      statusText: "Error",
      headers: {
        get() { return null; },
        getSetCookie() { return []; },
      } as unknown as Headers,
      json: () => Promise.resolve(body),
    } as Response;
  }

  function makeResource() {
    return new CallsResource(new HttpTransport("test-key", "https://inkbox.ai/api/v1"));
  }

  it("surfaces 409 no_shared_connection as InkboxAPIError with detail preserved", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeErrorResponse(409, {
        detail: {
          error: "no_shared_connection",
          message: "No active shared connection to this recipient",
        },
      }),
    );
    const res = makeResource();

    try {
      await res.place({
        toNumber: "+15551234567",
        origination: CallOrigin.SHARED_IMESSAGE_NUMBER,
        agentIdentityId: IDENTITY_ID,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InkboxAPIError);
      expect((err as InkboxAPIError).statusCode).toBe(409);
      const detail = (err as InkboxAPIError).detail as Record<string, unknown>;
      expect(detail.error).toBe("no_shared_connection");
      expect(detail.message).toBe("No active shared connection to this recipient");
    }
  });

  it("surfaces 422 validation errors as InkboxAPIError with detail preserved", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeErrorResponse(422, {
        detail: "from_number is required for dedicated_number origination",
      }),
    );
    const res = makeResource();

    try {
      await res.place({ toNumber: "+15551234567" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InkboxAPIError);
      expect((err as InkboxAPIError).statusCode).toBe(422);
      expect((err as InkboxAPIError).detail).toBe(
        "from_number is required for dedicated_number origination",
      );
    }
  });
});

describe("CallsResource surface (identity-centered, v1.0.0)", () => {
  it("exposes exactly list, get, hangup, transcripts, place, postCallActions", () => {
    const methods = Object.getOwnPropertyNames(CallsResource.prototype)
      .filter((n) => n !== "constructor")
      .sort();
    expect(methods).toEqual(["get", "hangup", "list", "place", "postCallActions", "transcripts"]);
  });
});
