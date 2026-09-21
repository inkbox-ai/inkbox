import { afterEach, expect, it, vi } from "vitest";
import { A2AClient, Inkbox, InkboxAPIError, type APIResponse, type ResponseMetadata } from "../src/index.js";
import { HttpTransport } from "../src/_http.js";
import { UnlockedVault } from "../src/vault/resources/vault.js";

const notice = { code: "future_code", level: "future_level", message: "Receiving and sending differ." };
const headers = { "Inkbox-Notices": JSON.stringify([notice]) };
const agent = {
  id: "identity-1", agent_handle: "example-agent", organization_id: "org-example", email_address: "x@example.com",
  display_name: null, description: null, mailbox: null, phone_number: null, tunnel: null,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};
afterEach(() => vi.restoreAllMocks());

it("observes errors, binary, scalar and empty responses without altering results or retrying", async () => {
  const observed: ResponseMetadata[] = [];
  const observer = vi.fn(async (metadata: ResponseMetadata) => { observed.push(metadata); throw new Error("observer failed"); });
  const http = new HttpTransport("test-key", "https://example.com/api/v1", 1200, undefined, undefined, observer);
  const request = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(null, { status: 204, headers }))
    .mockResolvedValueOnce(new Response(new Uint8Array([0, 255, 1]), { headers }))
    .mockResolvedValueOnce(Response.json(42, { headers }))
    .mockResolvedValueOnce(Response.json({ detail: "Denied", agent_support: "Contact support." }, { status: 403, headers }));
  expect(await http.delete("/notes/note-1")).toBeUndefined();
  const bytes = await http.getBytes("/download");
  expect(bytes.data).toEqual(new Uint8Array([0, 255, 1]));
  expect(bytes.headers.get("Inkbox-Notices")).toBe(headers["Inkbox-Notices"]);
  expect(await http.get("/scalar")).toBe(42);
  await expect(http.post("/notes", {})).rejects.toMatchObject({ statusCode: 403, agentSupport: "Contact support." });
  expect(observed).toEqual(Array(4).fill({ notices: [notice] }));
  expect(request).toHaveBeenCalledTimes(4);
});

it("normalizes optional headers, retains valid unknown entries, and prefers valid headers", async () => {
  const seen: ResponseMetadata[] = [];
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com", onResponse: (value) => { seen.push(value); } });
  const request = vi.spyOn(globalThis, "fetch");
  for (const header of [undefined, "null", "[]", "broken", '[{"code":1}]']) {
    request.mockResolvedValueOnce(Response.json([], { headers: header === undefined ? {} : { "Inkbox-Notices": header } }));
    expect(await client.withResponseMetadata((scope) => scope.listIdentities())).toEqual({ data: [] });
  }
  request.mockResolvedValueOnce(Response.json(agent, { headers: { "Inkbox-Notices": JSON.stringify([null, { code: 1 }, { ...notice, extra: true }]) } }));
  expect((await client.withResponseMetadata((scope) => scope.getIdentity("example-agent"))).notices).toEqual([notice]);
  request.mockResolvedValueOnce(Response.json({ ...agent, notices: [{ ...notice, code: "body" }] }, { headers }));
  expect((await client.withResponseMetadata((scope) => scope.getIdentity("example-agent"))).notices).toEqual([notice]);
  request.mockResolvedValueOnce(Response.json({ ...agent, notices: [notice] }, { headers: { "Inkbox-Notices": "[]" } }));
  expect((await client.withResponseMetadata((scope) => scope.getIdentity("example-agent"))).notices).toBeUndefined();
  expect(seen).toHaveLength(8);
});

it("uses only declared top-level body fallback and never mistakes user data for metadata", async () => {
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" });
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ ...agent, notices: [notice] }));
  const detail = await client.withResponseMetadata((scope) => scope.getIdentity("example-agent"));
  expect(detail.data.agentHandle).toBe("example-agent");
  expect(detail.notices).toEqual([notice]);
  request.mockResolvedValueOnce(Response.json({ notices: [notice], nested: { notices: [notice] } }));
  expect(await client.withResponseMetadata((scope) => scope._rootApiHttp.get("/v1/notes/note-1"))).toEqual({
    data: { notices: [notice], nested: { notices: [notice] } },
  });
  request.mockResolvedValueOnce(Response.json({ ...agent, nested: { notices: [notice] } }));
  expect((await client.withResponseMetadata((scope) => scope.getIdentity("example-agent"))).notices).toBeUndefined();
  request.mockResolvedValueOnce(new Response("not-json", { headers: { ...headers, "content-type": "application/json" } }));
  await expect(client.withResponseMetadata((scope) => scope.getIdentity("example-agent"))).rejects.toThrow();
});

it.each([
  ["GET", "/identities/example-agent/"],
  ["GET", "/identities/example-agent/contacts/contact-1/permissions/"],
  ["GET", "/contacts/contact-1/communication-policy/"],
  ["GET", "/mail/mailboxes/person@example.com/"],
  ["POST", "/identities/"],
  ["PUT", "/identities/example-agent/avatar/"],
])("reads declared %s %s body metadata without consuming the original", async (method, path) => {
  const observed = vi.fn();
  const http = new HttpTransport("test-key", "https://example.com/api/v1", 1000, undefined, undefined, observed);
  const body = { ...agent, notices: [notice] };
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(body));
  const call = () => method === "GET" ? http.get(path) : method === "POST" ? http.post(path, {}) : http.put(path, {});
  expect(await call()).toEqual(body);
  expect(observed).toHaveBeenLastCalledWith({ notices: [notice] });
  request.mockResolvedValueOnce(Response.json(body, { headers: { "Inkbox-Notices": '[{"code":1}]' } }));
  expect(await call()).toEqual(body);
  expect(observed).toHaveBeenLastCalledWith({ notices: [notice] });
  request.mockResolvedValueOnce(Response.json(body, { headers: { "Inkbox-Notices": JSON.stringify([{ ...notice, code: "header" }]) } }));
  expect(await call()).toEqual(body);
  expect(observed).toHaveBeenLastCalledWith({ notices: [{ ...notice, code: "header" }] });
});

it.each([
  ["GET", "/identities/"],
  ["GET", "/identities/example-agent/avatar/"],
  ["PUT", "/identities/example-agent/avatar/staged/"],
  ["GET", "/identities/example-agent/avatar-metadata/"],
  ["GET", "/identities/example-agent/notes/"],
])("does not infer body metadata from undeclared %s %s responses", async (method, path) => {
  const observed = vi.fn();
  const http = new HttpTransport("test-key", "https://example.com/api/v1", 1000, undefined, undefined, observed);
  const body = { notices: [notice] };
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(body));
  expect(await (method === "GET" ? http.get(path) : http.put(path, {}))).toEqual(body);
  expect(observed).toHaveBeenLastCalledWith({});
});

it("preserves binary avatar bytes and observes only their header metadata", async () => {
  const observed = vi.fn();
  const http = new HttpTransport("test-key", "https://example.com/api/v1", 1000, undefined, undefined, observed);
  const bytes = new Uint8Array([0, 255, 128, 3]);
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(bytes, { headers: { ...headers, "Content-Type": "image/jpeg" } }));
  expect((await http.getBytes("/identities/example-agent/avatar/")).data).toEqual(bytes);
  expect(observed).toHaveBeenLastCalledWith({ notices: [notice] });
});

it("isolates concurrent, nested, and parent calls while deduplicating multiple requests", async () => {
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const code = new URL(String(url)).pathname.split("/").at(-1)!;
    await new Promise((resolve) => setTimeout(resolve, code === "slow" ? 10 : 0));
    return Response.json(code, { headers: { "Inkbox-Notices": JSON.stringify([{ ...notice, code }]) } });
  });
  const [slow, fast] = await Promise.all([
    client.withResponseMetadata(async (scope) => {
      await scope._rootApiHttp.get("/slow");
      await scope._rootApiHttp.get("/slow");
      const nested = await scope.withResponseMetadata((inner) => inner._rootApiHttp.get("/nested"));
      expect(nested.notices?.map((item) => item.code)).toEqual(["nested"]);
      return "slow";
    }),
    client.withResponseMetadata((scope) => scope._rootApiHttp.get("/fast")),
    client._rootApiHttp.get("/parent"),
  ]);
  expect(slow).toEqual({ data: "slow", notices: [{ ...notice, code: "slow" }] });
  expect(fast).toEqual({ data: "fast", notices: [{ ...notice, code: "fast" }] });
});

it("retains cookies, auth, timeout, pending unlock and unlocked vault state without constructor requests", async () => {
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com", timeoutMs: 1500, userAgentPrefix: "example-client" });
  const unlocked = new UnlockedVault(client.vault.http, new Uint8Array(32), []);
  client._vaultUnlockPromise = Promise.resolve().then(() => { client.vault._unlocked = unlocked; });
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({}, { headers: { "set-cookie": "session=example; Path=/; Secure" } }));
  await client._rootApiHttp.get("/cookie");
  request.mockResolvedValueOnce(new Response(null, { status: 204, headers }));
  const result: APIResponse<void> = await client.withResponseMetadata(async (scope) => {
    await scope.ready();
    expect(request).toHaveBeenCalledTimes(1);
    expect(scope._timeoutMs).toBe(1500);
    expect(scope.vault.unlocked).not.toBeNull();
    expect(scope.vault.unlocked).not.toBe(unlocked);
    expect(scope.vault.unlocked?.secrets).toEqual([]);
    await scope.vault.unlocked!.deleteSecret("secret-1");
  });
  expect(result).toEqual({ data: null, notices: [notice] });
  expect(request.mock.calls[1][1]?.headers).toMatchObject({ "X-API-Key": "test-key", Cookie: "session=example" });
  expect((request.mock.calls[1][1]?.headers as Record<string, string>)["User-Agent"]).toContain("example-client");
  expect(client.vault.unlocked).toBe(unlocked);
});

it("does not await unrelated vault startup failures or mutate returned notice snapshots", async () => {
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" });
  client._vaultUnlockPromise = Promise.reject(new Error("Unlock failed"));
  void client._vaultUnlockPromise.catch(() => {});
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json([], { headers }));
  let retained!: Inkbox;
  const result = await client.withResponseMetadata(async (scope) => {
    retained = scope;
    return scope.listIdentities();
  });
  expect(result).toEqual({ data: [], notices: [notice] });
  request.mockResolvedValueOnce(Response.json([], { headers: { "Inkbox-Notices": JSON.stringify([{ ...notice, code: "later" }]) } }));
  await retained.listIdentities();
  expect(result.notices).toEqual([notice]);
});

it("observes a scoped failure before throwing its ordinary error", async () => {
  const observed = vi.fn();
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com", onResponse: observed });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ detail: "No access", agent_support: "Contact support." }, { status: 403, headers }));
  await expect(client.withResponseMetadata((scope) => scope.listIdentities())).rejects.toBeInstanceOf(InkboxAPIError);
  expect(observed).toHaveBeenCalledWith({ notices: [notice] });
});

it("observes protocol headers without treating arbitrary Agent Card fields as metadata", async () => {
  const onResponse = vi.fn();
  const client = new A2AClient("test-key", "https://example.com", { onResponse });
  const card = { supportedInterfaces: [{ protocolVersion: "1.0", protocolBinding: "JSONRPC", url: "https://example.com/a2a/rpc" }], notices: [notice] };
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(card))
    .mockResolvedValueOnce(Response.json(card, { headers }));
  await client.fetchCard("https://example.com/api/v1/identities/example-agent");
  expect(onResponse).toHaveBeenLastCalledWith({});
  await client.fetchCard("https://example.com/a2a/card");
  expect(onResponse).toHaveBeenLastCalledWith({ notices: [notice] });
});
