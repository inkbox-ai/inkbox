// sdk/typescript/tests/phone/calls.test.ts
import { describe, it, expect, vi } from "vitest";
import { CallsResource } from "../../src/phone/resources/calls.js";
import type { HttpTransport } from "../../src/_http.js";
import {
  RAW_PHONE_CALL,
  RAW_PHONE_CALL_BLOCKED,
  RAW_PHONE_CALL_WITH_RATE_LIMIT,
} from "../sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const NUM_ID = "aaaa1111-0000-0000-0000-000000000001";
const CALL_ID = "bbbb2222-0000-0000-0000-000000000001";

describe("CallsResource.list", () => {
  it("uses default limit and offset", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_PHONE_CALL]);
    const res = new CallsResource(http);

    const calls = await res.list(NUM_ID);

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/calls`, { limit: 50, offset: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].direction).toBe("outbound");
  });

  it("passes custom limit and offset", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new CallsResource(http);

    await res.list(NUM_ID, { limit: 10, offset: 20 });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/calls`, { limit: 10, offset: 20 });
  });

  it("omits is_blocked when not provided", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new CallsResource(http);

    await res.list(NUM_ID);

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/calls`, {
      limit: 50,
      offset: 0,
    });
  });

  it("forwards isBlocked=true for the admin-side blocked listing", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_PHONE_CALL_BLOCKED]);
    const res = new CallsResource(http);

    const calls = await res.list(NUM_ID, { isBlocked: true });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/calls`, {
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

    const calls = await res.list(NUM_ID, { isBlocked: false });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/calls`, {
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

    const calls = await res.list(NUM_ID);

    expect(calls[0].isBlocked).toBe(false);
  });
});

describe("CallsResource.get", () => {
  it("fetches by ID", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_PHONE_CALL);
    const res = new CallsResource(http);

    const call = await res.get(NUM_ID, CALL_ID);

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/calls/${CALL_ID}`);
    expect(call.status).toBe("completed");
  });
});

describe("CallsResource.place", () => {
  it("places call with required fields", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_PHONE_CALL_WITH_RATE_LIMIT);
    const res = new CallsResource(http);

    const call = await res.place({
      fromNumber: "+18335794607",
      toNumber: "+15167251294",
    });

    expect(http.post).toHaveBeenCalledWith("/place-call", {
      from_number: "+18335794607",
      to_number: "+15167251294",
    });
    expect(call.rateLimit.callsUsed).toBe(5);
  });

  it("includes optional fields when provided", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_PHONE_CALL_WITH_RATE_LIMIT);
    const res = new CallsResource(http);

    await res.place({
      fromNumber: "+18335794607",
      toNumber: "+15167251294",
      clientWebsocketUrl: "wss://agent.example.com/ws",
    });

    const [, body] = vi.mocked(http.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["client_websocket_url"]).toBe("wss://agent.example.com/ws");
  });

  it("omits optional fields when not provided", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_PHONE_CALL_WITH_RATE_LIMIT);
    const res = new CallsResource(http);

    await res.place({ fromNumber: "+18335794607", toNumber: "+15167251294" });

    const [, body] = vi.mocked(http.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["client_websocket_url"]).toBeUndefined();
  });
});
