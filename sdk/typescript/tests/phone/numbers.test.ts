// sdk/typescript/tests/phone/numbers.test.ts
import { describe, it, expect, vi } from "vitest";
import { PhoneNumbersResource } from "../../src/phone/resources/numbers.js";
import type { HttpTransport } from "../../src/_http.js";
import { RAW_PHONE_NUMBER, RAW_PHONE_TRANSCRIPT } from "../sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const NUM_ID = "aaaa1111-0000-0000-0000-000000000001";

describe("PhoneNumbersResource.list", () => {
  it("returns list of phone numbers", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_PHONE_NUMBER]);
    const res = new PhoneNumbersResource(http);

    const numbers = await res.list();

    expect(http.get).toHaveBeenCalledWith("/numbers");
    expect(numbers).toHaveLength(1);
    expect(numbers[0].number).toBe("+18335794607");
  });
});

describe("PhoneNumbersResource.get", () => {
  it("fetches by ID", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_PHONE_NUMBER);
    const res = new PhoneNumbersResource(http);

    const number = await res.get(NUM_ID);

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}`);
    expect(number.incomingCallAction).toBe("auto_reject");
  });

  it("parses incomingTextWebhookUrl", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue({
      ...RAW_PHONE_NUMBER,
      incoming_text_webhook_url: "https://example.com/texts",
    });
    const res = new PhoneNumbersResource(http);

    const number = await res.get(NUM_ID);

    expect(number.incomingTextWebhookUrl).toBe("https://example.com/texts");
  });
});

describe("PhoneNumbersResource.update", () => {
  it("sends incomingCallAction", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_PHONE_NUMBER);
    const res = new PhoneNumbersResource(http);

    await res.update(NUM_ID, { incomingCallAction: "auto_accept" });

    expect(http.patch).toHaveBeenCalledWith(`/numbers/${NUM_ID}`, {
      incoming_call_action: "auto_accept",
    });
  });

  it("omits undefined fields", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_PHONE_NUMBER);
    const res = new PhoneNumbersResource(http);

    await res.update(NUM_ID, {});

    expect(http.patch).toHaveBeenCalledWith(`/numbers/${NUM_ID}`, {});
  });

  it("sends incomingTextWebhookUrl", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue({
      ...RAW_PHONE_NUMBER,
      incoming_text_webhook_url: "https://example.com/texts",
    });
    const res = new PhoneNumbersResource(http);

    const number = await res.update(NUM_ID, {
      incomingTextWebhookUrl: "https://example.com/texts",
    });

    expect(http.patch).toHaveBeenCalledWith(`/numbers/${NUM_ID}`, {
      incoming_text_webhook_url: "https://example.com/texts",
    });
    expect(number.incomingTextWebhookUrl).toBe("https://example.com/texts");
  });
});

describe("PhoneNumbersResource.provision", () => {
  it("defaults to toll_free", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_PHONE_NUMBER);
    const res = new PhoneNumbersResource(http);

    await res.provision({ agentHandle: "sales-agent" });

    expect(http.post).toHaveBeenCalledWith("/numbers", {
      agent_handle: "sales-agent",
      type: "toll_free",
    });
  });

  it("passes type and state for local numbers", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({ ...RAW_PHONE_NUMBER, type: "local" });
    const res = new PhoneNumbersResource(http);

    const number = await res.provision({ agentHandle: "sales-agent", type: "local", state: "NY" });

    const [, body] = vi.mocked(http.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["state"]).toBe("NY");
    expect(number.type).toBe("local");
  });

  it("passes incomingTextWebhookUrl", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({
      ...RAW_PHONE_NUMBER,
      incoming_text_webhook_url: "https://example.com/texts",
    });
    const res = new PhoneNumbersResource(http);

    const number = await res.provision({
      agentHandle: "sales-agent",
      incomingTextWebhookUrl: "https://example.com/texts",
    });

    expect(http.post).toHaveBeenCalledWith("/numbers", {
      agent_handle: "sales-agent",
      type: "toll_free",
      incoming_text_webhook_url: "https://example.com/texts",
    });
    expect(number.incomingTextWebhookUrl).toBe("https://example.com/texts");
  });
});

describe("PhoneNumbersResource.release", () => {
  it("deletes by ID", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new PhoneNumbersResource(http);

    await res.release(NUM_ID);

    expect(http.delete).toHaveBeenCalledWith(`/numbers/${NUM_ID}`);
  });
});

describe("PhoneNumbersResource.searchTranscripts", () => {
  it("passes query and defaults", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_PHONE_TRANSCRIPT]);
    const res = new PhoneNumbersResource(http);

    const results = await res.searchTranscripts(NUM_ID, { q: "hello" });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/search`, {
      q: "hello",
      party: undefined,
      limit: 50,
    });
    expect(results[0].text).toBe("Hello, how can I help you?");
  });

  it("passes party and custom limit", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new PhoneNumbersResource(http);

    await res.searchTranscripts(NUM_ID, { q: "test", party: "remote", limit: 10 });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/search`, {
      q: "test",
      party: "remote",
      limit: 10,
    });
  });
});
