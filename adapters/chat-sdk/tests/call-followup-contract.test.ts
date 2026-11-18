import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chat, type Message, type Thread } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createInkboxAdapter } from "../src/index.js";

const baseUrl = "https://api.example.com";
const apiKey = "synthetic-call-key";
const signingSecret = "synthetic-call-signing-secret";
const timestamp = "2026-01-01T00:00:00Z";
const identityId = "identity-call";
const conversationId = "conversation-call";
const local = "+12025550100";
const remote = "+12025550123";
const smsPath = "/api/v1/phone/numbers/phone-call/texts";
const imessagePath = "/api/v1/imessage/messages";
type Origin =
  | "dedicated_number"
  | "shared_imessage_number"
  | "dedicated_imessage_number";
type Row = Record<string, unknown>;

function signed(eventType: string, data: Row, id = `event-${eventType}`) {
  const body = JSON.stringify({ id, event_type: eventType, timestamp, data });
  const time = String(Math.floor(Date.now() / 1000));
  const requestId = "call-request";
  const signature = createHmac("sha256", signingSecret)
    .update(`${requestId}.${time}.${body}`)
    .digest("hex");
  return new Request("https://app.example.com/webhook", {
    method: "POST",
    body,
    headers: {
      "x-inkbox-request-id": requestId,
      "x-inkbox-timestamp": time,
      "x-inkbox-signature": `sha256=${signature}`,
    },
  });
}

function callData(origin: string, overrides: Row = {}) {
  return {
    call: {
      id: "call-one",
      origin,
      local_phone_number: origin === "shared_imessage_number" ? null : local,
      remote_phone_number: remote,
      direction: "inbound",
      status: "completed",
      created_at: timestamp,
      ...overrides,
    },
    transcript: {
      entries: [{ party: "remote", text: "Please send the details." }],
      abridged: false,
    },
  };
}

function summary(origin: Origin, overrides: Row = {}): Row {
  return {
    id: conversationId,
    participants: [remote],
    is_group: false,
    ...(origin === "dedicated_number"
      ? { remote_phone_number: remote }
      : {
          remote_number: remote,
          assignment_id: "assignment-call",
          assignment_status: "active",
        }),
    latest_message_at: timestamp,
    latest_direction: "inbound",
    total_count: 1,
    ...overrides,
  };
}

function fixture(
  origin: Origin,
  options: {
    rows?: Row[];
    pages?: Row[][];
    identity?: Row;
    phone?: Row;
  } = {},
) {
  const requests: { method: string; url: URL; body?: Row; headers: Headers }[] =
    [];
  const identity = {
    id: identityId,
    organization_id: "organization-call",
    agent_handle: "assistant",
    email_address: "assistant@example.com",
    imessage_enabled: true,
    created_at: timestamp,
    updated_at: timestamp,
    mailbox: null,
    tunnel: null,
    imessage_number:
      origin === "dedicated_imessage_number"
        ? { id: "imessage-line", number: local, type: "dedicated_outbound" }
        : null,
    phone_number: {
      id: "phone-call",
      number: local,
      type: "local",
      status: "active",
      sms_status: "ready",
      incoming_call_action: "hosted_agent",
      created_at: timestamp,
      updated_at: timestamp,
      ...options.phone,
    },
    ...options.identity,
  };
  const text = {
    id: "text-before-call",
    direction: "inbound",
    conversation_id: conversationId,
    local_phone_number: local,
    remote_phone_number: remote,
    sender_phone_number: remote,
    remote_number: remote,
    sender_number: remote,
    participants: [remote],
    is_group: false,
    text: "Hello",
    content: "Hello",
    type: "sms",
    message_type: "text",
    service: "imessage",
    created_at: timestamp,
    updated_at: timestamp,
    is_read: false,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      expect(url.origin).toBe(baseUrl);
      expect(request.headers.get("x-api-key")).toBe(apiKey);
      const body =
        request.method === "POST" ? ((await request.json()) as Row) : undefined;
      requests.push({
        method: request.method,
        url,
        body,
        headers: request.headers,
      });
      if (request.method === "GET" && url.pathname === "/api/whoami")
        return Response.json({
          auth_type: "api_key",
          scope: `agent_identity:${identityId}`,
          organization_id: "organization-call",
        });
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/identities/assistant"
      )
        return Response.json(identity);
      const conversationsPath =
        origin === "dedicated_number"
          ? `${smsPath}/conversations`
          : "/api/v1/imessage/conversations";
      if (request.method === "GET" && url.pathname === conversationsPath) {
        expect(url.searchParams.getAll("participants")).toEqual([remote]);
        expect(url.searchParams.has("include_groups")).toBe(false);
        expect(url.searchParams.get("is_blocked")).toBe("false");
        expect(url.searchParams.get("limit")).toBe("100");
        if (origin !== "dedicated_number")
          expect(url.searchParams.get("agent_identity_id")).toBe(identityId);
        const offset = Number(url.searchParams.get("offset"));
        return Response.json(
          options.pages?.[offset / 100] ?? options.rows ?? [summary(origin)],
        );
      }
      if (
        request.method === "POST" &&
        url.pathname ===
          (origin === "dedicated_number" ? smsPath : imessagePath)
      ) {
        if (origin !== "dedicated_number")
          expect(url.searchParams.get("agent_identity_id")).toBe(identityId);
        const message = {
          ...text,
          id: "reply-after-call",
          direction: "outbound",
          text: body?.text,
          content: body?.text,
          status: "queued",
        };
        return Response.json(
          origin === "dedicated_number" ? message : { message },
        );
      }
      throw new Error(
        `Unexpected HTTP request: ${request.method} ${url.pathname}`,
      );
    }),
  );
  const adapter = createInkboxAdapter({
    apiKey,
    signingSecret,
    agentHandle: "assistant",
    baseUrl,
  });
  const bot = new Chat({
    userName: "assistant",
    adapters: { inkbox: adapter },
    state: createMemoryState(),
  });
  return {
    bot,
    adapter,
    requests,
    textRequest: () =>
      origin === "dedicated_number"
        ? signed("text.received", { text_message: text })
        : signed("imessage.received", { message: text }),
    callRequest: (overrides: Row = {}) =>
      signed("call.ended", callData(origin, overrides)),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("post-call SDK HTTP contracts", () => {
  it.each<Origin>([
    "dedicated_number",
    "shared_imessage_number",
    "dedicated_imessage_number",
  ])(
    "%s follows up in the existing messaging thread and deduplicates call replay",
    async (origin) => {
      const { bot, adapter, requests, textRequest, callRequest } =
        fixture(origin);
      const threadIds: string[] = [];
      const messageIds: string[] = [];
      const receive = async (thread: Thread, message: Message) => {
        threadIds.push(thread.id);
        messageIds.push(message.id);
        await thread.subscribe();
        if (message.text === "Hello") return;
        expect(message.text).toContain("Please send the details.");
        expect(message.text).toContain("not spoken on the call");
        expect(adapter.decodeThreadId(thread.id)).toMatchObject({
          identityId,
          channel: origin === "dedicated_number" ? "sms" : "imessage",
          conversationId,
        });
        await thread.post("Here are the details.");
      };
      bot.onNewMention(receive);
      bot.onSubscribedMessage(receive);
      try {
        expect((await bot.webhooks.inkbox(textRequest())).status).toBe(200);
        expect((await bot.webhooks.inkbox(callRequest())).status).toBe(200);
        expect((await bot.webhooks.inkbox(callRequest())).status).toBe(200);
        expect(threadIds).toHaveLength(2);
        expect(threadIds[1]).toBe(threadIds[0]);
        expect(messageIds[1]).not.toBe(messageIds[0]);
        const posts = requests.filter((request) => request.method === "POST");
        expect(posts).toHaveLength(1);
        expect(posts[0].url.pathname).toBe(
          origin === "dedicated_number" ? smsPath : imessagePath,
        );
        expect(posts[0].body).toEqual({
          conversation_id: conversationId,
          text: "Here are the details.",
        });
        expect(posts[0].headers.get("idempotency-key")).toBeTruthy();
        expect(posts[0].headers.get("prefer")).toBe("idempotency-replay");
      } finally {
        await bot.shutdown();
      }
    },
  );

  it("checks every filtered page before selecting the unique conversation", async () => {
    const released = Array.from({ length: 100 }, (_, index) =>
      summary("shared_imessage_number", {
        id: `released-${index}`,
        assignment_status: "released",
      }),
    );
    const { bot, adapter, requests, callRequest } = fixture(
      "shared_imessage_number",
      {
        pages: [released, [summary("shared_imessage_number")]],
      },
    );
    let channel: string | undefined;
    bot.onNewMention(async (thread) => {
      channel = adapter.decodeThreadId(thread.id).channel;
    });
    try {
      expect((await bot.webhooks.inkbox(callRequest())).status).toBe(200);
      expect(channel).toBe("imessage");
      expect(
        requests
          .filter((r) => r.url.pathname.endsWith("/conversations"))
          .map((r) => r.url.searchParams.get("offset")),
      ).toEqual(["0", "100"]);
    } finally {
      await bot.shutdown();
    }
  });

  const fallbackCases: {
    name: string;
    origin: Origin;
    rows?: Row[];
    call?: Row;
    identity?: Row;
    phone?: Row;
  }[] = [
    { name: "missing SMS conversation", origin: "dedicated_number", rows: [] },
    {
      name: "ambiguous SMS conversations",
      origin: "dedicated_number",
      rows: [
        summary("dedicated_number"),
        summary("dedicated_number", { id: "another-conversation" }),
      ],
    },
    {
      name: "different SMS local line",
      origin: "dedicated_number",
      call: { local_phone_number: "+12025550199" },
    },
    {
      name: "paused SMS line",
      origin: "dedicated_number",
      phone: { status: "paused" },
    },
    {
      name: "SMS line not ready",
      origin: "dedicated_number",
      phone: { sms_status: "pending" },
    },
    {
      name: "unknown call origin",
      origin: "dedicated_number",
      call: { origin: "unknown" },
    },
    {
      name: "non-phone remote",
      origin: "dedicated_number",
      call: { remote_phone_number: "anonymous" },
    },
    {
      name: "conference call",
      origin: "dedicated_number",
      call: { connections: [{ kind: "conference", status: "connected" }] },
    },
    {
      name: "released iMessage assignment",
      origin: "shared_imessage_number",
      rows: [
        summary("shared_imessage_number", { assignment_status: "released" }),
      ],
    },
    {
      name: "group iMessage conversation",
      origin: "shared_imessage_number",
      rows: [
        summary("shared_imessage_number", {
          is_group: true,
          participants: [remote, "+12025550199"],
        }),
      ],
    },
    {
      name: "different iMessage participant",
      origin: "shared_imessage_number",
      rows: [
        summary("shared_imessage_number", { remote_number: "+12025550199" }),
      ],
    },
    {
      name: "iMessage disabled",
      origin: "shared_imessage_number",
      identity: { imessage_enabled: false },
    },
    {
      name: "shared call after dedicated-line switch",
      origin: "shared_imessage_number",
      identity: {
        imessage_number: {
          id: "new-line",
          number: local,
          type: "dedicated_outbound",
        },
      },
    },
    {
      name: "different dedicated iMessage line",
      origin: "dedicated_imessage_number",
      call: { local_phone_number: "+12025550199" },
    },
  ];
  it.each(fallbackCases)(
    "$name stays observation-only without sending",
    async (scenario) => {
      const { bot, adapter, requests, callRequest } = fixture(
        scenario.origin,
        scenario,
      );
      const channels: string[] = [];
      bot.onNewMention(async (thread, message) => {
        const route = adapter.decodeThreadId(thread.id);
        channels.push(route.channel);
        expect(route).toEqual({
          identityId,
          channel: "voice",
          callId: "call-one",
        });
        expect(message.text).not.toContain("Any reply will be sent");
        if (route.channel !== "voice")
          await thread.post("Unexpected follow-up");
      });
      try {
        expect(
          (await bot.webhooks.inkbox(callRequest(scenario.call))).status,
        ).toBe(200);
        expect(channels).toEqual(["voice"]);
        expect(requests.filter((request) => request.method === "POST")).toEqual(
          [],
        );
      } finally {
        await bot.shutdown();
      }
    },
  );
});
