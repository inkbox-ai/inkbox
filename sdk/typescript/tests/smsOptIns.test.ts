// sdk/typescript/tests/smsOptIns.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport } from "../src/_http.js";
import { SmsOptInsResource } from "../src/phone/resources/smsOptIns.js";
import { SmsOptInSource, SmsOptInStatus } from "../src/phone/types.js";

const BASE = "https://inkbox.ai/api/v1/phone";

const OPT_IN_DICT = {
  id: "aaaa1111-0000-0000-0000-000000000020",
  organization_id: "org_test",
  receiver_number: "+15551234567",
  status: "opted_in",
  source: "customer_api",
  opted_in_at: "2026-05-15T12:00:00Z",
  opted_out_at: null,
  created_at: "2026-05-15T12:00:00Z",
  updated_at: "2026-05-15T12:00:00Z",
};

const OPT_OUT_DICT = {
  ...OPT_IN_DICT,
  id: "aaaa1111-0000-0000-0000-000000000021",
  status: "opted_out",
  source: "sms",
  opted_in_at: null,
  opted_out_at: "2026-05-15T12:05:00Z",
};

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get() { return null; },
      getSetCookie() { return []; },
    } as unknown as Headers,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("SmsOptInsResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list forwards status, limit, offset as query params", async () => {
    vi.mocked(fetch).mockResolvedValue(ok([OPT_IN_DICT, OPT_OUT_DICT]));
    const http = new HttpTransport("k", BASE);
    const resource = new SmsOptInsResource(http);

    const rows = await resource.list({
      status: SmsOptInStatus.OPTED_OUT,
      limit: 10,
      offset: 5,
    });

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("/sms-opt-ins");
    expect(url).toContain("status=opted_out");
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=5");
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe(SmsOptInStatus.OPTED_IN);
    expect(rows[0].source).toBe(SmsOptInSource.CUSTOMER_API);
    expect(rows[0].optedOutAt).toBeNull();
    expect(rows[0].optedInAt).toBeInstanceOf(Date);
  });

  it("list handles the {items} wrapper", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ items: [OPT_IN_DICT] }));
    const http = new HttpTransport("k", BASE);
    const resource = new SmsOptInsResource(http);

    const rows = await resource.list();

    expect(rows).toHaveLength(1);
    expect(rows[0].receiverNumber).toBe("+15551234567");
  });

  it("get hits /sms-opt-ins/{receiver}", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(OPT_IN_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new SmsOptInsResource(http);

    const row = await resource.get("+15551234567");

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("/sms-opt-ins/+15551234567");
    expect(row.status).toBe(SmsOptInStatus.OPTED_IN);
    expect(row.organizationId).toBe("org_test");
  });

  it("optIn posts to /opt-in", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(OPT_IN_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new SmsOptInsResource(http);

    const row = await resource.optIn("+15551234567");

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/sms-opt-ins/+15551234567/opt-in");
    expect(init.method).toBe("POST");
    expect(row.status).toBe(SmsOptInStatus.OPTED_IN);
    expect(row.source).toBe(SmsOptInSource.CUSTOMER_API);
  });

  it("optOut posts to /opt-out", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(OPT_OUT_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new SmsOptInsResource(http);

    const row = await resource.optOut("+15551234567");

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/sms-opt-ins/+15551234567/opt-out");
    expect(init.method).toBe("POST");
    expect(row.status).toBe(SmsOptInStatus.OPTED_OUT);
    expect(row.optedOutAt).toBeInstanceOf(Date);
    expect(row.optedInAt).toBeNull();
  });
});
