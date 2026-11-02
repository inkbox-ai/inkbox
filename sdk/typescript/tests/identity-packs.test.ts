import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { Inkbox, InkboxAPIError, InkboxConnectionError } from "../src/index.js";
import type { IdentityPackQuote, IdentityPacksResponse, IdentityPackMutationResponse } from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/identity_packs.json", import.meta.url), "utf8"));
const agreementId = fixture.mutation.agreement_id;
const requestKey = "22222222-2222-4222-8222-222222222222";
const resumeKey = "33333333-3333-4333-8333-333333333333";
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

it("preserves pagination, prorated quotes, monthly boundaries and payment-required acceptance", async () => {
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get("X-API-Key")).toBe("synthetic-admin-key");
    if (init.method === "GET") return response(fixture.list);
    if (url.endsWith("/quote")) return response(fixture.quote);
    return response(fixture.mutation, 202);
  });
  vi.stubGlobal("fetch", fetch);
  const client = new Inkbox({ apiKey: "synthetic-admin-key" });
  const page: IdentityPacksResponse = await client.billing.identityPacks();
  expect(page).toEqual(fixture.list);
  expect(fetch.mock.calls[0][0]).toBe("https://inkbox.ai/api/v1/billing/identity-packs");
  await client.billing.identityPacks({ cursor: page.next_cursor!, limit: 1 });
  expect(Object.fromEntries(new URL(fetch.mock.calls[1][0]).searchParams)).toEqual({ cursor: agreementId, limit: "1" });
  expect(page.capacity.total).toBe(10);
  expect(page.agreements[0].paid_through).toBeNull();
  const quote: IdentityPackQuote = await client.billing.quoteIdentityPack();
  expect(quote).toEqual(fixture.quote);
  expect(quote.monthly_amount).toBe("100.00");
  expect(quote.amount_due_cents).toBe(5000);
  expect(quote.renewal_at).toBe(2001209600);
  expect(quote.payment_mode).toBe("quantity");
  expect(fetch.mock.calls[2][0]).toBe("https://inkbox.ai/api/v1/billing/identity-packs/quote");
  expect(JSON.parse(String(fetch.mock.calls[2][1].body))).toEqual({});
  const options = { quote: quote.quote, requestKey };
  for (let i = 0; i < 2; i++) {
    const result: IdentityPackMutationResponse = await client.billing.purchaseIdentityPack(options);
    expect(result).toEqual(fixture.mutation);
    expect(result.status).toBe("requires_payment");
  }
  expect(fetch.mock.calls[3][1].body).toBe(fetch.mock.calls[4][1].body);
  expect(JSON.parse(String(fetch.mock.calls[3][1].body))).toEqual({
    quote: quote.quote, request_key: requestKey,
  });
  await client.billing.purchaseIdentityPack({ quote: quote.quote, requestKey });
  expect(JSON.parse(String(fetch.mock.calls[5][1].body))).toEqual({ quote: quote.quote, request_key: requestKey });
});

it("forwards the same purchase after an uncertain response", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Response interrupted"))
    .mockResolvedValueOnce(response(fixture.mutation, 202));
  vi.stubGlobal("fetch", fetch);
  const client = new Inkbox({ apiKey: "synthetic-admin-key" });
  const options = { quote: "accepted", requestKey };
  await expect(client.billing.purchaseIdentityPack(options)).rejects.toBeInstanceOf(InkboxConnectionError);
  expect(await client.billing.purchaseIdentityPack(options)).toEqual(fixture.mutation);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
});

it("retains each action UUID across opposite actions and retries", async () => {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => response({ ...fixture.mutation, status: "canceling", payment_url: null }, 202));
  vi.stubGlobal("fetch", fetch);
  const client = new Inkbox({ apiKey: "synthetic-admin-key" });
  for (let i = 0; i < 2; i++) {
    expect((await client.billing.cancelIdentityPack(agreementId, { requestKey })).payment_url).toBeNull();
    await client.billing.resumeIdentityPack(agreementId, { requestKey: resumeKey });
  }
  expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["cancel", "resume", "cancel", "resume"].map(action => `/api/v1/billing/identity-packs/${agreementId}/${action}`));
  expect(fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)))).toEqual([
    { request_key: requestKey }, { request_key: resumeKey }, { request_key: requestKey }, { request_key: resumeKey },
  ]);
});

it.each([[401, "Invalid API key"], [403, "Organization-admin API key required"], [409, fixture.conflict]])("preserves HTTP %s and its detail", async (status, detail) => {
  vi.stubGlobal("fetch", vi.fn(async () => response({ detail }, status as number)));
  const client = new Inkbox({ apiKey: "synthetic-key" });
  await expect(client.billing.cancelIdentityPack(agreementId, { requestKey }))
    .rejects.toMatchObject({ statusCode: status, detail, name: InkboxAPIError.name });
});

it("preserves an unavailable offer and the last page", async () => {
  const payload = { ...fixture.list, offer: null, agreements: [], next_cursor: null, eligible: false, eligibility_reason: fixture.paid_plan_required };
  vi.stubGlobal("fetch", vi.fn(async () => response(payload)));
  const client = new Inkbox({ apiKey: "synthetic-admin-key" });
  expect(await client.billing.identityPacks({ cursor: agreementId })).toEqual(payload);
});

it.each(["quote", "purchase", "resume"])("preserves retained agreements and the paid-plan requirement for %s", async (action) => {
  const payload = { ...fixture.list, eligible: false, eligibility_reason: fixture.paid_plan_required };
  const fetch = vi.fn(async (_url: string, init: RequestInit) => init.method === "GET"
    ? response(payload) : response({ detail: fixture.paid_plan_required }, 409));
  vi.stubGlobal("fetch", fetch);
  const client = new Inkbox({ apiKey: "synthetic-admin-key" });
  expect(await client.billing.identityPacks()).toEqual(payload);
  const result = action === "quote" ? client.billing.quoteIdentityPack()
    : action === "purchase" ? client.billing.purchaseIdentityPack({ quote: fixture.quote.quote, requestKey })
    : client.billing.resumeIdentityPack(agreementId, { requestKey: resumeKey });
  await expect(result).rejects.toMatchObject({ statusCode: 409, detail: fixture.paid_plan_required });
  expect(fetch).toHaveBeenCalledTimes(2);
});
