import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { Inkbox, type SlackCachedActor } from "../src/index.js";
const data = JSON.parse(readFileSync(new URL("../../../tests/fixtures/slack_cached_archive.json", import.meta.url), "utf8"));
const C = data.connection_id;
afterEach(() => vi.unstubAllGlobals());
function setup(response: unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(response)));
  vi.stubGlobal("fetch", fetch);
  return { fetch, client: new Inkbox({ apiKey: "synthetic-test-key", baseUrl: "https://example.com" }) };
}
it("preserves optional installation generation", async () => {
  const { connection } = JSON.parse(readFileSync(new URL("../../../tests/fixtures/slack.json", import.meta.url), "utf8"));
  for (const generation of [undefined, 3]) {
    const { client } = setup({ connections: [{ ...connection, generation }], installation_available: false });
    expect((await client.slack.listConnections(connection.identity_id)).connections[0].generation).toBe(generation);
  }
});
it("preserves unknown and zero counts, typed maps, raw rich content and exact expansion queries", async () => {
  const { fetch, client } = setup(data.page);
  const page = await client.slack.listArchivedMessages(C, { rootsOnly: true,
    include: ["conversation", "sender", "reactions", "files"], limit: 25, cursor: "previous" });
  expect(Object.fromEntries(new URL(String(fetch.mock.calls[0][0])).searchParams)).toEqual({
    roots_only: "true", include: "conversation,sender,reactions,files", limit: "25", cursor: "previous",
  });
  expect(page.messages[0]).toMatchObject({ replyCount: 3, latestReply: "1789552801.000100", reactionsComplete: false,
    reactions: [{ count: null, reacted: null, usersComplete: false }, { count: 0, reacted: false, usersComplete: true }] });
  expect(page.messages[0].blocks?.[0].block_id).toBe("keep_snake_case");
  const actor: SlackCachedActor | undefined = page.included?.actors.U123;
  expect(actor?.fetchedAt).toBeInstanceOf(Date);
  expect(page.included?.conversations.C123).toMatchObject({ name: null, membersComplete: false });
  expect(page.included?.emoji.celebrate.aliasOf).toBe("party");
  expect(page.included?.files.F123.previewUrl).toContain("/files/F123/preview");
  expect(page.nextCursor).toBe("opaque-next");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("keeps legacy reads unexpanded with unknown state", async () => {
  const raw = structuredClone(data.page); delete raw.included;
  for (const key of ["reactions", "reactions_complete", "reply_count"]) delete raw.messages[0][key];
  const { fetch, client } = setup(raw);
  const page = await client.slack.listArchivedMessages(C);
  expect(page.included).toBeNull();
  expect(page.messages[0]).toMatchObject({ reactions: null, reactionsComplete: null, replyCount: null });
  expect(Object.fromEntries(new URL(String(fetch.mock.calls[0][0])).searchParams)).toEqual({ limit: "50" });
});
it("searches one cached emoji page without following its cursor", async () => {
  const { fetch, client } = setup(data.emoji_page);
  const page = await client.slack.listCachedEmoji(C, { q: "party +", limit: 2, cursor: "previous" });
  expect(page).toMatchObject({ status: "pending", nextCursor: "party", emoji: [{ aliasOf: "party" }, { imageCached: true }] });
  expect(Object.fromEntries(new URL(String(fetch.mock.calls[0][0])).searchParams)).toEqual({ q: "party +", limit: "2", cursor: "previous" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("downloads cached media and file previews as authenticated bytes", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(new Uint8Array([0, 255, 1])));
  vi.stubGlobal("fetch", fetch);
  const client = new Inkbox({ apiKey: "synthetic-test-key", baseUrl: "https://example.com" });
  expect(await client.slack.downloadCachedMedia(C, "emoji", "party+")).toEqual(new Uint8Array([0, 255, 1]));
  expect(await client.slack.downloadFilePreview(C, "F123")).toEqual(new Uint8Array([0, 255, 1]));
  expect(new URL(String(fetch.mock.calls[0][0])).pathname).toBe(`/api/v1/slack/connections/${C}/cached-media/emoji/party%2B`);
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get("X-API-Key")).toBe("synthetic-test-key");
  expect(new URL(String(fetch.mock.calls[1][0])).pathname).toBe(`/api/v1/slack/connections/${C}/files/F123/preview`);
});
