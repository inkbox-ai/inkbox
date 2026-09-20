import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { CompanionInitializationError, Inkbox } from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/companion-v1.json", import.meta.url), "utf8"));
const activation = fixture.pages[0].activation_id;
const client = () => new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" });
afterEach(() => vi.restoreAllMocks());

it("preserves PATCH omission, explicit false, sponsor replacement and bounded state pagination", async () => {
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(fixture.config));
  const sdk = client();
  expect((await sdk.companion.get("example-agent")).sponsor).toBeUndefined();
  await sdk.companion.update("example-agent", { enabled: false });
  expect(JSON.parse(request.mock.calls.at(-1)![1]!.body as string)).toEqual({ enabled: false });
  await sdk.companion.update("example-agent", { sponsor: { emails: ["sponsor@example.com"], phoneNumbers: [], contactId: null } });
  expect(JSON.parse(request.mock.calls.at(-1)![1]!.body as string)).toEqual({ sponsor: { emails: ["sponsor@example.com"], phone_numbers: [], contact_id: null } });
  request.mockResolvedValueOnce(Response.json({ items: [], total: 0 }));
  expect(await sdk.companion.conversations("example-agent", { channel: "mail", limit: 200, offset: 10000 })).toEqual({ items: [], total: 0 });
  const url = new URL(String(request.mock.calls.at(-1)![0]));
  expect(Object.fromEntries(url.searchParams)).toEqual({ channel: "mail", limit: "200", offset: "10000" });
  await expect(sdk.companion.update("example-agent", { enabled: null } as any)).rejects.toThrow();
  await expect(sdk.companion.update("example-agent", { sponsor: null } as any)).rejects.toThrow();
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

it.each(["scope", "activation", "channel", "reply", "audience", "conflict", "cursor", "incomplete", "no-trigger", "two-triggers"])("rejects %s inconsistency without returning partial history", async (mutation) => {
  const pages = structuredClone(fixture.pages);
  const second = pages[1];
  if (mutation === "scope") second.scope_id = second.conversation_id;
  if (mutation === "activation") second.activation_id = second.scope_id;
  if (mutation === "channel") second.channel = "phone";
  if (mutation === "reply") second.reply_context.conversation_id = second.scope_id;
  if (mutation === "audience") second.reply_context.to = ["someone@example.com"];
  if (mutation === "conflict") second.items[0].text = "different";
  if (mutation === "cursor") Object.assign(second, { history_complete: false, next_cursor: "opaque-page-2" });
  if (mutation === "incomplete") Object.assign(second, { history_complete: false, next_cursor: null });
  if (mutation === "no-trigger") second.items.pop();
  if (mutation === "two-triggers") Object.assign(pages[0].items[0], { historical: false, is_trigger: true });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => Response.json(pages[new URL(String(url)).searchParams.has("cursor") ? 1 : 0]));
  await expect(client().companion.loadInitialization("example-agent", activation)).rejects.toBeInstanceOf(CompanionInitializationError);
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
