import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { Inkbox } from "../src/index.js";
const data = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/slack_operations.json", import.meta.url),
    "utf8",
  ),
);
const C = data.connection_id,
  O = data.operation_id,
  TS = data.message_ts;
const key = { idempotencyKey: "stable-key" };
function calls(s: Inkbox["slack"]): Record<string, () => Promise<unknown>> {
  return {
    start_installation: () => s.startInstallation(C, { workspaceId: "T123" }),
    capabilities: () => s.capabilities(C),
    list_users: () => s.listUsers(C, { limit: 2, cursor: "opaque" }),
    get_user: () => s.getUser(C, "U123"),
    list_members: () =>
      s.listMembers(C, "C123", { limit: 2, cursor: "opaque" }),
    get_message: () =>
      s.getMessage(C, "C123", TS, { threadTs: "1234567890.000000" }),
    message_context: () => s.messageContext(C, "C123", TS),
    get_permalink: () => s.getPermalink(C, "C123", TS),
    get_reactions: () => s.getReactions(C, "C123", TS),
    list_pins: () => s.listPins(C, "C123"),
    get_operation: () => s.getOperation(C, O),
    add_reaction: () => s.addReaction(C, "C123", TS, "eyes", key),
    remove_reaction: () => s.removeReaction(C, "C123", TS, "eyes", key),
    add_pin: () => s.addPin(C, "C123", TS, key),
    remove_pin: () => s.removePin(C, "C123", TS, key),
    update_message: () => s.updateMessage(C, "C123", TS, "edited", key),
    delete_message: () => s.deleteMessage(C, "C123", TS, key),
    join_conversation: () => s.joinConversation(C, "C123", key),
    leave_conversation: () => s.leaveConversation(C, "C123", key),
    set_processing_status: () =>
      s.setProcessingStatus(C, "C123", TS, "processing", key),
    upload_file: () =>
      s.uploadFile(C, {
        conversationId: "C123",
        filename: "binary.dat",
        contentBase64: "AP8B",
        threadTs: TS,
        ...key,
      }),
    get_archive_settings: () => s.getArchiveSettings(C),
    update_archive_settings: () =>
      s.updateArchiveSettings(C, {
        captureEnabled: true,
        retentionDays: null,
        conversationIds: ["C123"],
      }),
    list_archived_messages: () =>
      s.listArchivedMessages(C, {
        conversationId: "C123",
        threadTs: TS,
        beforeTs: "1234567891.000000",
        afterTs: "1234567889.000000",
        limit: 2,
        cursor: "opaque",
      }),
    search_archived_messages: () =>
      s.searchArchivedMessages(C, "retained message", {
        conversationId: "C123",
        userId: "U123",
        beforeTs: "1234567891.000000",
        afterTs: "1234567889.000000",
        limit: 2,
        cursor: "opaque",
      }),
    archive_backfill: () =>
      s.archiveBackfill(C, "C123", { threadTs: TS, restart: true }),
    list_archive_coverage: () =>
      s.listArchiveCoverage(C, { limit: 2, cursor: O }),
    purge_archive: () => s.purgeArchive(C),
  };
}
afterEach(() => vi.unstubAllGlobals());
for (const testCase of data.cases) {
  it(`exact wire and typed response: ${testCase.name}`, async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(testCase.response), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    const client = new Inkbox({
      apiKey: "synthetic-test-key",
      baseUrl: "https://example.com",
    });
    const result = await calls(client.slack)[testCase.name]();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/api/v1" + testCase.path);
    expect(init?.method).toBe(testCase.method);
    expect(Object.fromEntries(parsed.searchParams)).toEqual(testCase.query);
    expect(init?.body ? JSON.parse(String(init.body)) : null).toEqual(
      testCase.body,
    );
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(
      testCase.idempotency_key,
    );
    if (testCase.idempotency_key)
      expect(result).toMatchObject({ id: O, status: "unknown", messageTs: TS });
    if (testCase.name === "capabilities")
      expect(result).toMatchObject({
        capabilities: { files_upload: { scopesSatisfied: false } },
      });
    if (testCase.name === "list_archived_messages")
      expect(result).toMatchObject({
        messages: [{ capturedAt: expect.any(Date), sourceUrl: null }],
      });
  });
  if (testCase.idempotency_key)
    it(`does not retry ${testCase.name}`, async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "Unavailable" }), {
            status: 503,
          }),
        );
      vi.stubGlobal("fetch", fetch);
      const client = new Inkbox({
        apiKey: "synthetic-test-key",
        baseUrl: "https://example.com",
      });
      await expect(calls(client.slack)[testCase.name]()).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    });
}
it("rejects runtime numeric timestamps and invalid keys before dispatch", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const s = new Inkbox({
    apiKey: "synthetic-test-key",
    baseUrl: "https://example.com",
  }).slack;
  await expect(
    s.getMessage(C, "C123", 123.1 as unknown as string),
  ).rejects.toThrow("timestamps");
  await expect(
    s.listArchivedMessages(C, { beforeTs: 123.1 as unknown as string }),
  ).rejects.toThrow("timestamps");
  await expect(
    s.deleteMessage(C, "C123", TS, { idempotencyKey: "" }),
  ).rejects.toThrow("idempotencyKey");
  expect(fetch).not.toHaveBeenCalled();
});
