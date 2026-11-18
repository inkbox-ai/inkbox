import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chat, type Attachment } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createInkboxAdapter } from "../src/index.js";

const baseUrl = "https://api.example.com";
const apiKey = "synthetic-contract-key";
const signingSecret = "synthetic-signing-secret";
const timestamp = "2026-01-01T00:00:00Z";
const identityId = "identity-contract";
const conversationId = "conversation-contract";
const textPath = "/api/v1/phone/numbers/phone-contract/texts";
const inbound = {
  id: "incoming-contract",
  direction: "inbound",
  local_phone_number: "+12025550100",
  remote_phone_number: "+12025550123",
  sender_phone_number: "+12025550123",
  conversation_id: conversationId,
  text: "Hello",
  type: "sms",
  is_read: false,
  created_at: timestamp,
  updated_at: timestamp,
  media: null,
};
const identity = {
  id: identityId,
  organization_id: "organization-contract",
  agent_handle: "assistant",
  email_address: "assistant@example.com",
  created_at: timestamp,
  updated_at: timestamp,
  mailbox: null,
  tunnel: null,
  phone_number: {
    id: "phone-contract",
    number: "+12025550100",
    type: "local",
    status: "active",
    incoming_call_action: "auto_reject",
    client_websocket_url: null,
    created_at: timestamp,
    updated_at: timestamp,
  },
};

function signed(withMedia = false) {
  const body = JSON.stringify({
    id: "event-contract",
    event_type: "text.received",
    timestamp,
    data: {
      text_message: {
        ...inbound,
        ...(withMedia
          ? {
              type: "mms",
              media: [
                {
                  content_type: "image/png",
                  size: 3,
                  url: "https://media.example.com/stale",
                },
              ],
            }
          : {}),
      },
    },
  });
  const time = String(Math.floor(Date.now() / 1000));
  const requestId = "request-contract";
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

// Only the HTTP boundary is replaced: Chat, the adapter, SDK resource methods,
// response parsing, and SDK request serialization all run unchanged.
function wireFixture(scope = `agent_identity:${identityId}`) {
  const requests: Array<{
    method: string;
    path: string;
    headers: Headers;
    body: unknown;
  }> = [];
  const accepted = new Map<string, string>();
  let mediaReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      expect(url.origin).toBe(baseUrl);
      expect(request.headers.get("x-api-key")).toBe(apiKey);
      const body = request.method === "POST" ? await request.json() : undefined;
      requests.push({
        method: request.method,
        path: url.pathname,
        headers: request.headers,
        body,
      });
      if (request.method === "GET" && url.pathname === "/api/whoami") {
        return Response.json({
          auth_type: "api_key",
          scope,
          organization_id: "organization-contract",
        });
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/identities/assistant"
      ) {
        return Response.json(identity);
      }
      if (
        request.method === "GET" &&
        url.pathname === `${textPath}/${inbound.id}`
      ) {
        mediaReads++;
        return Response.json({
          ...inbound,
          type: "mms",
          media: [
            {
              content_type: "image/png",
              size: 3,
              url: `https://media.example.com/photo?generation=${mediaReads}`,
            },
          ],
        });
      }
      if (request.method === "POST" && url.pathname === textPath) {
        const key = request.headers.get("idempotency-key")!;
        const serialized = JSON.stringify(body);
        if (accepted.has(key) && accepted.get(key) !== serialized) {
          return Response.json(
            { detail: { error: "idempotency_key_reused" } },
            { status: 409 },
          );
        }
        accepted.set(key, serialized);
        return Response.json({
          ...inbound,
          id: "outgoing-contract",
          direction: "outbound",
          text: body.text,
          sender_phone_number: null,
          delivery_status: "queued",
        });
      }
      const taskMatch = url.pathname.match(
        /^\/api\/v1\/identities\/assistant\/a2a\/tasks\/(task-first|task-second|task-other|task-wrong-receiver)(\/reply)?$/,
      );
      if (taskMatch) {
        const taskId = taskMatch[1];
        const task = {
          id: taskId,
          context_id:
            taskId === "task-other" ? "context-other" : "context-shared",
          state: "working",
          caller: {
            identity_id: "caller-contract",
            organization_id: "caller-org",
          },
          target: {
            identity_id:
              taskId === "task-wrong-receiver"
                ? "another-identity"
                : identityId,
            organization_id: "organization-contract",
          },
          messages: [],
          created_at: timestamp,
          updated_at: timestamp,
        };
        if (request.method === "GET" && !taskMatch[2])
          return Response.json(task);
        if (request.method === "POST" && taskMatch[2]) {
          return Response.json({
            ...task,
            messages: [
              {
                id: `row-${taskId}`,
                message_id: `protocol-${taskId}`,
                role: "agent",
                parts: body.parts,
                created_at: timestamp,
              },
            ],
          });
        }
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
  return { adapter, bot, requests, accepted, mediaReads: () => mediaReads };
}

afterEach(() => vi.unstubAllGlobals());

describe("real SDK HTTP contracts", () => {
  it("routes a signed webhook through Chat and serializes the reply through the SDK", async () => {
    const { bot, requests } = wireFixture();
    bot.onNewMention(async (thread, message) => {
      expect(message.text).toBe("Hello");
      await thread.post("Reply from Chat");
    });
    try {
      expect((await bot.webhooks.inkbox(signed())).status).toBe(200);
      expect((await bot.webhooks.inkbox(signed())).status).toBe(200);
      const posts = requests.filter((request) => request.method === "POST");
      expect(posts).toHaveLength(1);
      expect(posts[0].path).toBe(textPath);
      expect(posts[0].body).toEqual({
        conversation_id: conversationId,
        text: "Reply from Chat",
      });
      expect(posts[0].headers.get("idempotency-key")).toMatch(
        /^[0-9a-f-]{36}$/,
      );
      expect(posts[0].headers.get("prefer")).toBe("idempotency-replay");
      expect(requests.some((request) => request.path === "/api/whoami")).toBe(
        true,
      );
      expect(
        requests.some(
          (request) => request.path === "/api/v1/identities/assistant",
        ),
      ).toBe(true);
    } finally {
      await bot.shutdown();
    }
  });

  it("replays identical MMS wire payloads after adapter restart without refreshing media", async () => {
    const { adapter, bot, requests, accepted, mediaReads } = wireFixture();
    let threadId = "";
    let attachments: Attachment[] = [];
    bot.onNewMention(async (thread, message) => {
      threadId = thread.id;
      attachments = JSON.parse(JSON.stringify(message.attachments));
      await adapter.send(
        threadId,
        { raw: "Forwarded photo", attachments },
        { idempotencyKey: "forward-operation" },
      );
    });
    try {
      expect((await bot.webhooks.inkbox(signed(true))).status).toBe(200);
      const restarted = createInkboxAdapter({
        apiKey,
        signingSecret,
        agentHandle: "assistant",
        baseUrl,
      });
      await restarted.initialize(bot);
      await restarted.send(
        threadId,
        { raw: "Forwarded photo", attachments },
        { idempotencyKey: "forward-operation" },
      );
      const posts = requests.filter((request) => request.method === "POST");
      expect(posts).toHaveLength(2);
      expect(posts.map((request) => request.path)).toEqual([
        textPath,
        textPath,
      ]);
      const expected = {
        conversation_id: conversationId,
        text: "Forwarded photo",
        media_urls: ["https://media.example.com/photo?generation=1"],
      };
      expect(posts.map((request) => request.body)).toEqual([
        expected,
        expected,
      ]);
      const key = createHash("sha256")
        .update("forward-operation")
        .digest("hex");
      expect(
        posts.map((request) => request.headers.get("idempotency-key")),
      ).toEqual([key, key]);
      expect(
        posts.every(
          (request) => request.headers.get("prefer") === "idempotency-replay",
        ),
      ).toBe(true);
      expect(mediaReads()).toBe(1);
      expect(accepted.size).toBe(1);
    } finally {
      await bot.shutdown();
    }
  });

  it("rejects an authenticated key belonging to another identity before any send", async () => {
    const { bot, requests } = wireFixture("agent_identity:another-identity");
    const handler = vi.fn();
    bot.onNewMention(handler);
    try {
      await expect(bot.webhooks.inkbox(signed())).rejects.toThrow(
        "does not belong to the configured identity",
      );
      expect(handler).not.toHaveBeenCalled();
      expect(
        requests.filter((request) => request.method === "POST"),
      ).toHaveLength(0);
    } finally {
      await bot.shutdown();
    }
  });

  it("keeps A2A context threads shared while replying through each explicitly bound task", async () => {
    const { adapter, bot, requests } = wireFixture();
    const route = {
      identityId,
      channel: "a2a" as const,
      contextId: "context-shared",
    };
    const firstThread = adapter.encodeThreadId({
      ...route,
      taskId: "task-first",
    });
    const secondThread = adapter.encodeThreadId({
      ...route,
      taskId: "task-second",
    });
    expect(firstThread).toBe(secondThread);
    await bot.initialize();
    try {
      const first = await adapter.send(firstThread, "First answer", {
        a2aTaskId: "task-first",
        a2aIntent: "complete",
      });
      const second = await adapter.send(secondThread, "Second answer", {
        a2aTaskId: "task-second",
        a2aIntent: "ask_caller",
      });
      const taskRequests = requests.filter((request) =>
        request.path.includes("/a2a/"),
      );
      expect(
        taskRequests.map((request) => [request.method, request.path]),
      ).toEqual([
        ["GET", "/api/v1/identities/assistant/a2a/tasks/task-first"],
        ["POST", "/api/v1/identities/assistant/a2a/tasks/task-first/reply"],
        ["GET", "/api/v1/identities/assistant/a2a/tasks/task-second"],
        ["POST", "/api/v1/identities/assistant/a2a/tasks/task-second/reply"],
      ]);
      expect(
        taskRequests
          .filter((request) => request.method === "POST")
          .map((request) => request.body),
      ).toEqual([
        { intent: "complete", parts: [{ text: "First answer" }] },
        { intent: "ask_caller", parts: [{ text: "Second answer" }] },
      ]);
      expect(first.raw.id).toBe("protocol-task-first");
      expect(second.raw.id).toBe("protocol-task-second");
    } finally {
      await bot.shutdown();
    }
  });

  it.each(["task-other", "task-wrong-receiver"])(
    "refuses A2A task %s before POST when its context or receiver differs",
    async (taskId) => {
      const { adapter, bot, requests } = wireFixture();
      const threadId = adapter.encodeThreadId({
        identityId,
        channel: "a2a",
        contextId: "context-shared",
      });
      await bot.initialize();
      try {
        await expect(
          adapter.send(threadId, "Must not send", { a2aTaskId: taskId }),
        ).rejects.toThrow(
          "A2A task does not belong to this context and receiver",
        );
        expect(
          requests.some(
            (request) =>
              request.method === "GET" &&
              request.path ===
                `/api/v1/identities/assistant/a2a/tasks/${taskId}`,
          ),
        ).toBe(true);
        expect(
          requests.filter((request) => request.method === "POST"),
        ).toHaveLength(0);
      } finally {
        await bot.shutdown();
      }
    },
  );
});
