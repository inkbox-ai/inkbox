import { afterEach, expect, it, vi } from "vitest";
import { Inkbox } from "../src/inkbox.js";

afterEach(() => vi.unstubAllGlobals());

it("keeps decimal and unknown prices and sends the same purchase identity", async () => {
  const payload = { prices: [{ code: "calls", amount: "0.0005", published_amount: "0.0005", pricing_state: "priced" },
    { code: "sms", amount: null, pricing_state: "unknown" }] };
  const fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const client = new Inkbox({ apiKey: "synthetic-test-key" });
  expect(await client.billing.pricing()).toEqual(payload);
  const options = { quote: "accepted-quote", requestKey: "a3f22fcb-d805-4811-830c-2c61c3da5316" };
  await client.billing.purchaseCountry("FR", options);
  await client.billing.purchaseCountry("FR", options);
  const requests = fetch.mock.calls as unknown as [string, RequestInit][];
  expect(requests[1][0]).toBe("https://inkbox.ai/api/v1/billing/calling-countries");
  expect(JSON.parse(String(requests[1][1].body))).toEqual({ country_code: "FR", quote: options.quote, request_key: options.requestKey });
  expect(requests[1][1].body).toBe(requests[2][1].body);
});


it("quotes and purchases multiple countries in one request with a stable retry key", async () => {
  const fetch = vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const client = new Inkbox({ apiKey: "synthetic-test-key" });
  await client.billing.quoteCountries(["FR", "JP"]);
  const options = { quote: "accepted", requestKey: "a3f22fcb-d805-4811-830c-2c61c3da5316" };
  await client.billing.purchaseCountries(["FR", "JP"], options);
  await client.billing.purchaseCountries(["FR", "JP"], options);
  const requests = fetch.mock.calls as unknown as [string, RequestInit][];
  expect(requests[0][0]).toContain("/billing/calling-countries/quote");
  expect(JSON.parse(String(requests[0][1].body))).toEqual({ country_codes: ["FR", "JP"] });
  expect(JSON.parse(String(requests[1][1].body))).toEqual({ country_codes: ["FR", "JP"], quote: options.quote, request_key: options.requestKey });
  expect(requests[1][1].body).toBe(requests[2][1].body);
});

it("preserves line bundle purchase identity and encodes agreement paths", async () => {
  const fetch = vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const client = new Inkbox({ apiKey: "synthetic-test-key" });
  await client.billing.quoteLineBundle("personal_imessage_line_bundle");
  const options = { quote: "accepted", requestKey: "a3f22fcb-d805-4811-830c-2c61c3da5316" };
  await client.billing.purchaseLineBundle("voip_line_bundle", options);
  await client.billing.purchaseLineBundle("voip_line_bundle", options);
  await client.billing.cancelLineBundle(options.requestKey);
  await client.billing.resumeLineBundle(options.requestKey);
  const requests = fetch.mock.calls as unknown as [string, RequestInit][];
  expect(JSON.parse(String(requests[0][1].body))).toEqual({ code: "personal_imessage_line_bundle" });
  expect(JSON.parse(String(requests[1][1].body))).toEqual({ code: "voip_line_bundle", quote: options.quote, request_key: options.requestKey });
  expect(requests[1][1].body).toBe(requests[2][1].body);
  expect(requests[3][0]).toContain(`/line-bundles/${options.requestKey}/cancel`);
  expect(requests[4][0]).toContain(`/line-bundles/${options.requestKey}/resume`);
});

it("lists defaults and preserves explicit disabled alert settings", async () => {
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => init.method === "DELETE"
    ? new Response(null, { status: 204 }) : Response.json(init.method === "GET" ? [{ is_default: true }] : {}));
  vi.stubGlobal("fetch", fetch);
  const client = new Inkbox({ apiKey: "synthetic-test-key" });
  expect((await client.billing.usageAlerts())[0].is_default).toBe(true);
  await client.billing.saveUsageAlert("example", { metric: "identities", threshold: 90, enabled: false });
  expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({ metric: "identities", threshold: 90, enabled: false });
  await client.billing.deleteUsageAlert("example");
  expect(fetch.mock.calls[2][1].method).toBe("DELETE");
});


it.each([true, false])("saves edits to a listed alert without response-only fields (default: %s)", async (is_default) => {
  const alert = { id: "b7cde7d9-cf46-53c3-84fd-259a878c9874", metric: "identities", threshold: 90, enabled: true, mailbox_id: null, is_default };
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => Response.json(init.method === "GET" ? [alert] : alert));
  vi.stubGlobal("fetch", fetch);
  const client = new Inkbox({ apiKey: "synthetic-test-key" });
  const [listed] = await client.billing.usageAlerts();
  await client.billing.saveUsageAlert(listed.id, { ...listed, threshold: 80, enabled: false });
  expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({ metric: "identities", threshold: 80, enabled: false, mailbox_id: null });
});
