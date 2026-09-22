import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionInitializationError, Inkbox } from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/companion-v1.json", import.meta.url), "utf8"));
const activation = fixture.pages[0].activation_id;
const client = (apiKey = "test-key") => new Inkbox({ apiKey, baseUrl: "https://example.com" });
afterEach(() => vi.restoreAllMocks());

function uppercaseIds(page: any) {
  const result = structuredClone(page);
  for (const key of ["scope_id", "activation_id", "conversation_id"]) result[key] = result[key].toUpperCase();
  for (const key of ["conversation_id", "reply_to_message_id"]) {
    if (result.reply_context[key]) result.reply_context[key] = result.reply_context[key].toUpperCase();
  }
  for (const entry of result.items) entry.id = entry.id.toUpperCase();
  return result;
}

it.each([activation, activation.toUpperCase()])("accepts UUID case variants for activation %s", async (requestedId) => {
  const request = vi.spyOn(globalThis, "fetch");
  for (const page of [fixture.pages[0], uppercaseIds(fixture.pages[0])]) {
    request.mockResolvedValueOnce(Response.json(page));
    const result = await client().companion.activationMessages("example-agent", requestedId);
    expect(result.activationId).toBe(activation);
    expect(result.scopeId).toBe(fixture.pages[0].scope_id);
    expect(result.replyContext.conversationId).toBe(fixture.pages[0].conversation_id);
    expect(result.replyContext.replyToMessageId).toBe(fixture.pages[0].reply_context.reply_to_message_id);
    expect(result.items.map((item) => item.id)).toEqual(fixture.pages[0].items.map((item: any) => item.id));
  }
});

it.each(["mail", "phone", "imessage"])("normalizes %s UUIDs across pages, duplicates and revalidation", async (channel) => {
  const pages = structuredClone(fixture.pages);
  for (const page of pages) {
    page.channel = page.reply_context.channel = channel;
    if (channel !== "mail") Object.assign(page.reply_context, { to: null, cc: null, reply_to_message_id: null });
  }
  pages[0].reply_context.conversation_id = pages[0].conversation_id.toUpperCase();
  const request = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(pages[0]))
    .mockResolvedValueOnce(Response.json(uppercaseIds(pages[1])))
    .mockResolvedValueOnce(Response.json(uppercaseIds(pages[0])));
  const result = await client().companion.loadInitialization("example-agent", activation.toUpperCase());
  expect(result.entries.map((entry) => entry.id)).toEqual([...pages[0].items, pages[1].items[1]].map((entry) => entry.id));
  expect(result.replyContext.conversationId).toBe(pages[0].conversation_id);
  expect(result.entries[0].attachments).toEqual(pages[0].items[0].attachments);
  expect(result.entries[1].text).toBe(pages[0].items[1].text);
  expect(request).toHaveBeenCalledTimes(3);
});

it.each(["activationMessages", "loadInitialization"] as const)("rejects a different valid activation UUID in %s", async (method) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(fixture.pages[0]));
  await expect(client().companion[method]("example-agent", fixture.pages[0].scope_id.toUpperCase()))
    .rejects.toBeInstanceOf(CompanionInitializationError);
});

describe.each(["test-agent-key", "test-admin-key"])("configuration reads with %s", (apiKey) => {
  describe.each(["config", "config_without_resources"])("%s", (configName) => {
    it.each([false, true])("returns only enabled state, readiness and notices with enabled=%s", async (enabled) => {
      const config = { ...fixture[configName], enabled, notices: fixture.pages[0].notices };
      const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(config));
      expect(await client(apiKey).companion.get("example-agent")).toEqual({
        enabled, configRevision: config.config_revision, readiness: config.readiness, notices: config.notices,
      });
      expect(request).toHaveBeenCalledTimes(1);
      const [url, init] = request.mock.calls[0];
      expect(new URL(String(url)).pathname).toBe("/api/v1/identities/example-agent/companion");
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("x-api-key")).toBe(apiKey);
    });
  });
});

it.each([{}, { enabled: true }, { enabled: false }, { enabled: undefined }])("PATCH sends only enabled without resources: %j", async (options) => {
  const config = { ...fixture.config_without_resources, enabled: options.enabled ?? true };
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(config));
  const result = await client().companion.update("example-agent", options);
  expect(result.enabled).toBe(config.enabled);
  expect(Object.values(result.readiness).every((readiness) => !readiness.ready)).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  const [url, init] = request.mock.calls[0];
  expect(new URL(String(url)).pathname).toBe("/api/v1/identities/example-agent/companion");
  expect(new URL(String(url)).search).toBe("");
  expect(init?.method).toBe("PATCH");
  expect(JSON.parse(init?.body as string)).toEqual(options.enabled === undefined ? {} : options);
});

it.each([null, "true", 1, {}])("rejects non-boolean enabled locally: %j", async (enabled) => {
  const request = vi.spyOn(globalThis, "fetch");
  await expect(client().companion.update("example-agent", { enabled } as never)).rejects.toThrow("enabled must be a boolean");
  expect(request).not.toHaveBeenCalled();
});

it.each([
  { sponsor: { emails: ["trusted@example.com"], phoneNumbers: [] } },
  { sponsor: null }, { sponsor: undefined }, { enabled: true, sponsor: {} },
  { configRevision: 2 }, { enabld: true }, null, [], "true",
])("rejects unknown or malformed update options locally: %j", async (options) => {
  const request = vi.spyOn(globalThis, "fetch");
  await expect(client().companion.update("example-agent", options as never)).rejects.toThrow("Companion update accepts only enabled");
  expect(request).not.toHaveBeenCalled();
});

it("preserves bounded state pagination", async () => {
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ items: [], total: 0 }));
  expect(await client().companion.conversations("example-agent", { channel: "mail", limit: 200, offset: 10000 })).toEqual({ items: [], total: 0 });
  const url = new URL(String(request.mock.calls.at(-1)![0]));
  expect(Object.fromEntries(url.searchParams)).toEqual({ channel: "mail", limit: "200", offset: "10000" });
});

it.each(["mail", "phone", "imessage"])("hydrates %s once with canonical scope, duplicate removal, notices and attachment refs", async (channel) => {
  const pages = structuredClone(fixture.pages);
  for (const page of pages) {
    page.channel = page.reply_context.channel = channel;
    if (channel !== "mail") Object.assign(page.reply_context, { to: null, cc: null, reply_to_message_id: null });
  }
  const cursors: (string | null)[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const cursor = new URL(String(url)).searchParams.get("cursor");
    cursors.push(cursor);
    return Response.json(pages[cursor ? 1 : 0]);
  });
  const result = await client().withResponseMetadata((sdk) => sdk.companion.loadInitialization("example-agent", activation));
  expect(cursors).toEqual([null, "opaque-page-2", null]);
  expect(result.data.entries).toHaveLength(3);
  expect(result.data.entries.filter((entry) => entry.isTrigger)).toHaveLength(1);
  expect(result.data.text.match(/Please join this conversation\./g)).toHaveLength(1);
  expect(result.data.text).toContain("\\nCan you review this?");
  expect(result.data.entries[0].attachments).toEqual(pages[0].items[0].attachments);
  expect(result.data.replyContext.conversationId).toBe(pages[0].conversation_id);
  expect(result.notices).toEqual(pages[0].notices);
  expect(result.data.notices).toEqual(pages[0].notices);
});

it.each(["scope", "activation", "conversation", "channel", "reply", "reply-message", "audience", "conflict", "cursor", "incomplete", "no-trigger", "two-triggers"])("rejects %s inconsistency without returning partial history", async (mutation) => {
  const pages = structuredClone(fixture.pages);
  const second = pages[1];
  if (mutation === "scope") second.scope_id = second.conversation_id;
  if (mutation === "activation") second.activation_id = second.scope_id;
  if (mutation === "conversation") second.conversation_id = second.reply_context.conversation_id = second.scope_id;
  if (mutation === "channel") second.channel = "phone";
  if (mutation === "reply") second.reply_context.conversation_id = second.scope_id;
  if (mutation === "reply-message") second.reply_context.reply_to_message_id = second.scope_id;
  if (mutation === "audience") second.reply_context.to = ["someone@example.com"];
  if (mutation === "conflict") Object.assign(second.items[0], { id: second.items[0].id.toUpperCase(), text: "different" });
  if (mutation === "cursor") Object.assign(second, { history_complete: false, next_cursor: "opaque-page-2" });
  if (mutation === "incomplete") Object.assign(second, { history_complete: false, next_cursor: null });
  if (mutation === "no-trigger") second.items.pop();
  if (mutation === "two-triggers") Object.assign(pages[0].items[0], { historical: false, is_trigger: true });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => Response.json(pages[new URL(String(url)).searchParams.has("cursor") ? 1 : 0]));
  await expect(client().companion.loadInitialization("example-agent", activation)).rejects.toBeInstanceOf(CompanionInitializationError);
});

it("preserves case-sensitive UUID-shaped cursors", async () => {
  const first = structuredClone(fixture.pages[0]);
  first.next_cursor = first.scope_id.toUpperCase();
  const second = { ...fixture.pages[1], history_complete: false, next_cursor: first.scope_id };
  const request = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(first))
    .mockResolvedValueOnce(Response.json(second))
    .mockResolvedValueOnce(Response.json(fixture.pages[1]))
    .mockResolvedValueOnce(Response.json(first));
  const result = await client().companion.loadInitialization("example-agent", activation);
  expect(result.entries).toHaveLength(3);
  expect(request.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("cursor")))
    .toEqual([null, first.scope_id.toUpperCase(), first.scope_id, null]);
});

it("propagates revocation on final revalidation and stops at byte/page bounds", async () => {
  const request = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(fixture.pages[0]))
    .mockResolvedValueOnce(Response.json(fixture.pages[1]))
    .mockResolvedValueOnce(Response.json({ detail: "Activation unavailable" }, { status: 403 }));
  await expect(client().companion.loadInitialization("example-agent", activation)).rejects.toMatchObject({ statusCode: 403 });
  request.mockImplementation(async () => Response.json(fixture.pages[0]));
  for (const bounds of [{ maxBytes: 100 }, { maxPages: 1 }]) {
    await expect(client().companion.loadInitialization("example-agent", activation, bounds)).rejects.toBeInstanceOf(CompanionInitializationError);
  }
});

it("revalidates a single-page attachment-only trigger", async () => {
  const page = structuredClone(fixture.pages[1]);
  page.items = [page.items[1]];
  page.items[0].text = "";
  page.items[0].attachments = [{ index: 0, content_type: "image/png" }];
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(page));
  const result = await client().companion.loadInitialization("example-agent", activation);
  expect(result.entries).toHaveLength(1);
  expect(request).toHaveBeenCalledTimes(2);
});


it("retains mixed sender access through all initialization pages and rendered context", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    return Response.json(fixture.pages[url.searchParams.has("cursor") ? 1 : 0]);
  });
  const result = await client().companion.loadInitialization("example-agent", activation);
  expect(result.entries.map((entry) => entry.senderAccess)).toEqual(["sponsored", undefined, "direct"]);
  expect(result.text).toContain('"senderAccess":"sponsored"');
  expect(result.text).toContain('"senderAccess":"direct"');
  expect(result.entries[1]).not.toHaveProperty("senderAccess");
});

it.each(["trusted", "ordinary", "", null, true])("rejects invalid sender access %s", async (senderAccess) => {
  const page = structuredClone(fixture.pages[0]);
  page.items[0].sender_access = senderAccess;
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(page));
  await expect(client().companion.activationMessages("example-agent", activation))
    .rejects.toBeInstanceOf(CompanionInitializationError);
});

it("does not infer direct admission for legacy history", async () => {
  const page = structuredClone(fixture.pages[0]);
  for (const entry of page.items) delete entry.sender_access;
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(page));
  const result = await client().companion.activationMessages("example-agent", activation);
  for (const entry of result.items) expect(entry).not.toHaveProperty("senderAccess");
});
