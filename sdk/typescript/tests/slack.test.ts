import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Inkbox,
  IdempotencyKeyReusedError,
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
  "slack.dm_received",
  "slack.group_dm_received",
  "slack.channel_message_received",
  "slack.mention_received",
  "slack.thread_reply_received",
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
  expect(await check(
    fixture.provisioning_workspace,
    () => c.slack.saveProvisioningWorkspace({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh" }),
    "POST", "/provisioning-workspaces",
    { access_token: "synthetic-access", refresh_token: "synthetic-refresh" },
  )).toMatchObject({ id: fixture.provisioning_workspace.id, tokenExpiresAt: new Date(fixture.provisioning_workspace.token_expires_at) });
  expect(await check(
    { workspaces: [fixture.provisioning_workspace] },
    () => c.slack.listProvisioningWorkspaces(),
    "GET", "/provisioning-workspaces",
  )).toMatchObject([{ id: fixture.provisioning_workspace.id }]);
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
  expect(fetch).toHaveBeenCalledTimes(12);
});
it.each([73, 0, null])("preserves immediate send retry delay %s and supports read-only recovery", async (retryAfter) => {
  const c = client();
  const { fetch, reply } = mock();
  const failed = { ...fixture.action, status: "failed", error_code: "rate_limited" };
  reply({ ...failed, retry_after: retryAfter });
  const result = await c.slack.sendMessage(C, {
    conversationId: "CEXAMPLE", text: "Hello", idempotencyKey: "original:1",
  });
  expect(result).toMatchObject({ status: "failed", retryAfter });
  expect(fetch).toHaveBeenCalledTimes(1);
  reply(failed);
  expect(await c.slack.getActionByKey(C, "original:1")).toMatchObject({
    id: result.id, retryAfter: null,
  });
  const [input, init] = fetch.mock.calls.at(-1)!;
  const url = new URL(String(input));
  expect(url.pathname).toBe(`/api/v1/slack/connections/${C}/actions/by-key`);
  expect(url.search).toBe("");
  expect(init?.method).toBe("GET");
  expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("original:1");
  reply(failed);
  expect((await c.slack.getAction(C, result.id)).retryAfter).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("does not send when key lookup returns not found", async () => {
  const { fetch, reply } = mock();
  reply({ detail: "Slack action not found" }, 404);
  await expect(client().slack.getActionByKey(C, "original:1"))
    .rejects.toMatchObject({ statusCode: 404 });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1]?.method).toBe("GET");
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
it.each(events.slice(0, 5))("uses ordinary event selection for %s", async (eventType) => {
  const { fetch, reply } = mock();
  const subs = client().webhooks.subscriptions;
  reply({ ...fixture.subscription, event_types: [eventType] });
  const row = await subs.create({
    url: "https://example.com/hook", agentIdentityId: I, eventTypes: [eventType],
  });
  expect(row).not.toHaveProperty("slackFilter");
  expect(row.eventTypes).toEqual([eventType]);
  expect(fetch.mock.calls.at(-1)![1]?.method).toBe("POST");
  expect(new URL(String(fetch.mock.calls.at(-1)![0])).pathname).toBe("/api/v1/webhooks/subscriptions");
  expect(JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body))).toEqual({
    url: "https://example.com/hook", agent_identity_id: I, event_types: [eventType],
  });
  reply(fixture.subscription);
  await subs.update(row.id, { eventTypes: [eventType] });
  expect(fetch.mock.calls.at(-1)![1]?.method).toBe("PATCH");
  expect(JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body))).toEqual({ event_types: [eventType] });
});
it.each([null, {}, { messageKinds: ["mention"] }])("rejects removed filter options without sending: %j", async (slackFilter) => {
  const { fetch } = mock();
  const subs = client().webhooks.subscriptions;
  const legacy = { url: "https://example.com/hook", agentIdentityId: I,
    eventTypes: ["slack.mention_received"], slackFilter };
  await expect(subs.create(legacy)).rejects.toThrow("filters have been removed");
  await expect(subs.update(fixture.subscription.id, legacy)).rejects.toThrow("filters have been removed");
  const legacyWire = { ...legacy, slack_filter: slackFilter };
  delete (legacyWire as { slackFilter?: unknown }).slackFilter;
  await expect(subs.create(legacyWire)).rejects.toThrow("filters have been removed");
  await expect(subs.update(fixture.subscription.id, legacyWire)).rejects.toThrow("filters have been removed");
  expect(fetch).not.toHaveBeenCalled();
});
it("exports the exact 23 event types", () => {
  expect(events).toHaveLength(23);
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


it.each([["slack.mention_received"], ["slack.mention_received", "message.received"]])(
  "keeps Slack context and mixed events compatible with identity scope: %j",
  async (...eventTypes) => {
    const { fetch, reply } = mock();
    const subs = client().webhooks.subscriptions;
    const contextConfig = { email: { mode: "count" as const, count: 1 } };
    reply({ ...fixture.subscription, event_types: eventTypes });
    const row = await subs.create({
      url: "https://example.com/hook", agentIdentityId: I, eventTypes, contextConfig,
    });
    expect(JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body))).toEqual({
      url: "https://example.com/hook", agent_identity_id: I, event_types: eventTypes,
      context_config: contextConfig,
    });
    for (const [options, wire] of [
      [{}, {}],
      [{ contextConfig: null }, { context_config: null }],
      [{ authToken: "synthetic-token" }, { auth_token: "synthetic-token" }],
    ] as const) {
      reply(fixture.subscription);
      await subs.update(row.id, { scope: "identity", eventTypes, ...options });
      const [url, init] = fetch.mock.calls.at(-1)!;
      expect(new URL(String(url)).searchParams.get("scope")).toBe("identity");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ event_types: eventTypes, ...wire });
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  },
);

it.each(["send", "reaction"])(
  "preserves the typed conflict without repeating a Slack %s write",
  async (operation) => {
    const c = client();
    const { fetch, reply } = mock();
    reply({ detail: {
      error: "idempotency_key_reused",
      message: "This key was already used for another request.",
    } }, 409);
    const request = operation === "send"
      ? c.slack.sendMessage(C, {
          conversationId: "CEXAMPLE", text: "Hello", idempotencyKey: "used-key",
        })
      : c.slack.addReaction(C, "CEXAMPLE", "1780000000.000001", "eyes", {
          idempotencyKey: "used-key",
        });
    await expect(request).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);


it.each([
  { threadTs: undefined, window: "messages_at_or_before_timestamp" },
  { threadTs: "1780000000.000000", window: "messages_at_or_after_timestamp" },
])("preserves context direction $window and thread selection", async ({ threadTs, window }) => {
  const c = client();
  const { fetch, reply } = mock();
  reply({
    messages: [{ ts: "1780000000.000001", text: "Selected message" }],
    next_cursor: null, has_more: false, window, complete: false,
  });
  const context = await c.slack.messageContext(C, "CEXAMPLE", "1780000000.000001", {
    limit: 5, threadTs,
  });
  expect(context.window).toBe(window);
  expect(context.messages[0].ts).toBe("1780000000.000001");
  const url = new URL(String(fetch.mock.calls[0][0]));
  expect(Object.fromEntries(url.searchParams)).toEqual({
    limit: "5", ...(threadTs ? { thread_ts: threadTs } : {}),
  });
});


it.each([403, 409, 422, 429, 503])("does not retry credential saves after HTTP %s", async (status) => {
  const c = client();
  const { fetch, reply } = mock();
  reply({ detail: "Workspace credentials could not be saved" }, status);
  await expect(c.slack.saveProvisioningWorkspace({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh" })).rejects.toMatchObject({ statusCode: status });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("parses saved workspace metadata without exposing echoed credential fields", async () => {
  const c = client();
  const { reply } = mock();
  reply({ workspaces: [{ ...fixture.provisioning_workspace, token_expires_at: null,
    status: "reauthorization_required", access_token: "must-not-surface", refresh_token: "must-not-surface" }] });
  const saved = await c.slack.listProvisioningWorkspaces();
  expect(saved[0].tokenExpiresAt).toBeNull();
  expect(saved[0].status).toBe("reauthorization_required");
  expect(JSON.stringify(saved)).not.toContain("must-not-surface");
});
