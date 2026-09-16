import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Inkbox,
  type SlackWebhookPayload,
  type SlackWebhookEventType,
} from "../src/index.js";
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/slack.json", import.meta.url),
    "utf8",
  ),
);
const C = fixture.connection.id;
const I = fixture.connection.identity_id;
const payloads: SlackWebhookPayload[] = JSON.parse(
  readFileSync(
    new URL(
      "../../../tests/fixtures/slack_webhook_events.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const events: SlackWebhookEventType[] = [
  "slack.message_received",
  "slack.message_updated",
  "slack.message_deleted",
  "slack.reaction_added",
  "slack.reaction_removed",
  "slack.member_joined",
  "slack.member_left",
  "slack.channel_updated",
  "slack.file_shared",
  "slack.file_changed",
  "slack.file_deleted",
  "slack.pin_added",
  "slack.pin_removed",
  "slack.connection_changed",
  "slack.message_sent",
  "slack.message_send_failed",
  "slack.message_send_unknown",
  "slack.interaction",
  "slack.session_stopped",
];
const client = () =>
  new Inkbox({ apiKey: "synthetic-test-key", baseUrl: "https://example.com" });
afterEach(() => vi.unstubAllGlobals());
function mock() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  const reply = (data: unknown, status = 200) =>
    fetch.mockResolvedValueOnce(
      new Response(data instanceof Uint8Array ? data : JSON.stringify(data), {
        status,
      }),
    );
  return { fetch, reply };
}
it("maps every Slack operation to exact wire requests and returns raw bytes", async () => {
  const c = client();
  const { fetch, reply } = mock();
  async function check(
    data: unknown,
    call: () => Promise<unknown>,
    method: string,
    path: string,
    body?: unknown,
    query: Record<string, string> = {},
  ) {
    reply(data);
    const result = await call();
    const [input, init] = fetch.mock.calls.at(-1)!;
    const url = new URL(String(input));
    expect(url.pathname).toBe("/api/v1/slack" + path);
    expect(init?.method).toBe(method);
    expect(Object.fromEntries(url.searchParams)).toEqual(query);
    if (body !== undefined)
      expect(JSON.parse(String(init?.body))).toEqual(body);
    return result;
  }
  expect(
    await check(
      { connections: [fixture.connection], installation_available: false },
      () => c.slack.listConnections(I),
      "GET",
      "/connections",
      undefined,
      { identity_id: I },
    ),
  ).toMatchObject({ installationAvailable: false });
  expect(
    await check(
      fixture.invitation,
      () => c.slack.createInvitation(I, { expiresInSeconds: 300 }),
      "POST",
      "/invitations",
      { identity_id: I, expires_in_seconds: 300 },
    ),
  ).toMatchObject({ invitationUrl: fixture.invitation.invitation_url });
  await check(
    [{ ...fixture.invitation, invitation_url: null }],
    () => c.slack.listInvitations(I),
    "GET",
    "/invitations",
    undefined,
    { identity_id: I },
  );
  await check(
    fixture.invitation,
    () => c.slack.revokeInvitation(fixture.invitation.id),
    "POST",
    `/invitations/${fixture.invitation.id}/revoke`,
  );
  await check(
    fixture.connection,
    () => c.slack.disconnect(C),
    "POST",
    `/connections/${C}/disconnect`,
  );
  expect(
    await check(
      { conversations: [{ id: "CEXAMPLE" }], next_cursor: "next" },
      () => c.slack.listConversations(C, { limit: 2, cursor: "cur" }),
      "GET",
      `/connections/${C}/conversations`,
      undefined,
      { limit: "2", cursor: "cur" },
    ),
  ).toMatchObject({ nextCursor: "next" });
  await check(
    { id: "DEXAMPLE" },
    () => c.slack.openConversation(C, ["UALICE", "UBOB"]),
    "POST",
    `/connections/${C}/conversations`,
    { user_ids: ["UALICE", "UBOB"] },
  );
  await check(
    { id: "CEXAMPLE" },
    () => c.slack.getConversation(C, "CEXAMPLE"),
    "GET",
    `/connections/${C}/conversations/CEXAMPLE`,
  );
  expect(
    await check(
      {
        messages: [{ ts: "1780000000.000001" }],
        next_cursor: null,
        has_more: false,
      },
      () =>
        c.slack.listMessages(C, "CEXAMPLE", { threadTs: "1780000000.000001" }),
      "GET",
      `/connections/${C}/conversations/CEXAMPLE/messages`,
      undefined,
      { limit: "15", thread_ts: "1780000000.000001" },
    ),
  ).toMatchObject({ nextCursor: null });
  expect(
    await check(
      fixture.action,
      () =>
        c.slack.sendMessage(C, {
          conversationId: "CEXAMPLE",
          text: "Hello",
          idempotencyKey: "operation:1",
          threadTs: "1780000000.000001",
        }),
      "POST",
      `/connections/${C}/messages`,
      {
        conversation_id: "CEXAMPLE",
        text: "Hello",
        thread_ts: "1780000000.000001",
      },
    ),
  ).toMatchObject({ status: "unknown" });
  expect(
    new Headers(fetch.mock.calls.at(-1)![1]?.headers).get("Idempotency-Key"),
  ).toBe("operation:1");
  await check(
    fixture.action,
    () => c.slack.getAction(C, fixture.action.id),
    "GET",
    `/connections/${C}/actions/${fixture.action.id}`,
  );
  await check(
    fixture.file,
    () => c.slack.getFile(C, "FEXAMPLE"),
    "GET",
    `/connections/${C}/files/FEXAMPLE`,
  );
  expect(
    await check(
      new Uint8Array([0, 255, 128, 1]),
      () => c.slack.downloadFile(C, "FEXAMPLE"),
      "GET",
      `/connections/${C}/files/FEXAMPLE/content`,
    ),
  ).toEqual(new Uint8Array([0, 255, 128, 1]));
  expect(fetch).toHaveBeenCalledTimes(13);
});
it.each([409, 429, 503])(
  "does not retry rejected or ambiguous send (%s)",
  async (status) => {
    const { fetch, reply } = mock();
    reply({ detail: "Unable to send" }, status);
    await expect(
      client().slack.sendMessage(C, {
        conversationId: "CEXAMPLE",
        text: "Hello",
        idempotencyKey: "operation:1",
      }),
    ).rejects.toMatchObject({ statusCode: status });
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it("preserves, clears and replaces filters without allowing cross-channel context", async () => {
  const { fetch, reply } = mock();
  const subs = client().webhooks.subscriptions;
  reply(fixture.subscription);
  const row = await subs.create({
    url: "https://example.com/hook",
    agentIdentityId: I,
    eventTypes: events,
    slackFilter: { messageKinds: ["mention", "thread"] },
  });
  expect(row.slackFilter?.messageKinds).toEqual(["mention", "thread"]);
  expect(
    JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body)).slack_filter,
  ).toEqual({ message_kinds: ["mention", "thread"] });
  reply(fixture.subscription);
  await subs.update(row.id, { url: "https://example.com/new" });
  expect(
    JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body)),
  ).not.toHaveProperty("slack_filter");
  reply(fixture.subscription);
  await subs.update(row.id, { slackFilter: null });
  expect(JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body))).toEqual({
    slack_filter: null,
  });
  reply(fixture.subscription);
  await subs.update(row.id, {
    slackFilter: { connectionIds: [C], conversationIds: null },
  });
  expect(JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body))).toEqual({
    slack_filter: { connection_ids: [C], conversation_ids: null },
  });
  await expect(
    subs.create({
      url: "https://example.com/hook",
      phoneNumberId: I,
      eventTypes: ["text.received"],
      slackFilter: {},
    }),
  ).rejects.toThrow("only supported for Slack");
  await expect(
    subs.create({
      url: "https://example.com/hook",
      agentIdentityId: I,
      eventTypes: events,
      contextConfig: { email: { mode: "count", count: 1 } },
    }),
  ).rejects.toThrow("not supported for Slack");
  await expect(
    subs.update(row.id, { slackFilter: { messageKinds: [] } }),
  ).rejects.toThrow("nonempty");
  await expect(
    subs.update(row.id, { slackFilter: { messageKinds: ["dm", "dm"] } }),
  ).rejects.toThrow("distinct");
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("exports the exact 19 event types", () => {
  expect(events).toHaveLength(19);
  expect(events).toEqual(payloads.map((p) => p.event_type));
});
it("rejects absent/invalid keys and numeric timestamps before sending", async () => {
  const { fetch } = mock();
  const c = client();
  for (const key of [undefined, "", "bad key", "x".repeat(129)])
    await expect(
      c.slack.sendMessage(C, {
        conversationId: "CEXAMPLE",
        text: "Hi",
        idempotencyKey: key as string,
      }),
    ).rejects.toThrow("idempotencyKey");
  await expect(
    c.slack.listMessages(C, "CEXAMPLE", { threadTs: 1.5 as unknown as string }),
  ).rejects.toThrow("string");
  expect(fetch).not.toHaveBeenCalled();
});

it("accepts explicit null for optional Slack thread and cursor fields", async () => {
  const { fetch, reply } = mock();
  const c = client();
  reply(fixture.action);
  await c.slack.sendMessage(C, {
    conversationId: "CEXAMPLE",
    text: "Hello",
    idempotencyKey: "operation:1",
    threadTs: null,
  });
  expect(
    JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body)).thread_ts,
  ).toBeNull();
  reply({ messages: [], next_cursor: null });
  await c.slack.listMessages(C, "CEXAMPLE", { threadTs: null, cursor: null });
  const url = new URL(String(fetch.mock.calls.at(-1)![0]));
  expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "15" });
});
