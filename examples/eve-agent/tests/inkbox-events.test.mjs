import assert from "node:assert/strict";
import { test } from "node:test";
import { Chat } from "chat";
import { createInkboxAdapter } from "@inkbox/chat-sdk-adapter";
import { inkboxChannelEvents, INKBOX_EVE_A2A_INTENT } from "../agent/lib/inkbox-events.ts";

function fixture(channel = "a2a") {
  const sends = [];
  let initialized = false;
  const bot = { initialize: async () => { await Promise.resolve(); initialized = true; } };
  const adapter = {
    decodeThreadId: () => ({ channel }),
    send: async (...args) => { assert.equal(initialized, true, "initialize must finish before sending"); sends.push(args); },
  };
  const ctx = { channel: { bot, thread: { id: "thread-test", toJSON: () => ({ currentMessage: { id: "bound-message-test" } }) }, state: {} }, session: { id: "session-test", turn: { id: "turn-test" } } };
  return { events: inkboxChannelEvents(adapter), sends, ctx };
}
const reply = (text = "Task result") => ({ data: { kind: "text", phase: "reply", value: text, partId: "part-test" } });
const settled = outcome => ({ data: { turnId: "turn-test", outcome, reply: ["part-test"] } });

test("A2A waits for successful turn settlement before completing", async () => {
  const { events, ctx, sends } = fixture();
  await events["content.completed"](reply(), ctx);
  assert.equal(sends.length, 0);
  await events["turn.settled"](settled("completed"), ctx);
  assert.equal(sends.length, 1);
  assert.equal(sends[0][1], "Task result");
  assert.equal(sends[0][2].a2aIntent, "complete");
});

test("failed turns do not complete an earlier partial reply", async () => {
  const { events, ctx, sends } = fixture();
  await events["content.completed"](reply("Partial result"), ctx);
  await events["turn.settled"](settled("failed"), ctx);
  assert.equal(sends[0][2].a2aIntent, "fail");
  await events["session.ended"]({ data: { outcome: "failed" } }, ctx);
  assert.equal(sends.length, 1);
});

test("session failure fails an open A2A task and cancellation leaves it open", async () => {
  const { events, ctx, sends } = fixture();
  await events["content.completed"](reply(), ctx);
  await events["turn.settled"](settled("cancelled"), ctx);
  assert.equal(sends.length, 0);
  await events["session.ended"]({ data: { outcome: "failed" } }, ctx);
  assert.equal(sends[0][2].a2aIntent, "fail");
});

test("ordinary channels still receive final text and failure notices", async () => {
  const { events, ctx, sends } = fixture("sms");
  await events["content.completed"](reply(), ctx);
  assert.deepEqual(sends[0][1], { markdown: "Task result" });
  assert.equal(sends[0][2].a2aIntent, undefined);
  await events["turn.settled"](settled("failed"), ctx);
  assert.equal(sends.length, 2);
});

test("unoverridden bridge prompt posts ask the A2A caller instead of completing", async () => {
  const adapter = createInkboxAdapter({ apiKey: "test-key", agentHandle: "test-agent", signingSecret: "test-secret", defaultA2AIntent: INKBOX_EVE_A2A_INTENT });
  let intent;
  adapter.transport.send = async (_route, input) => { intent = input.a2aIntent; return { id: "message-test", raw: {} }; };
  const threadId = adapter.encodeThreadId({ identityId: "identity-test", channel: "a2a", taskId: "task-test" });
  await adapter.postMessage(threadId, "Which option should I use?");
  assert.equal(intent, "ask_caller");
});

test("deferred email replies and failure notices retain the bound message anchor", async () => {
  const { events, ctx, sends } = fixture("email");
  await events["content.completed"](reply(), ctx);
  await events["turn.settled"](settled("failed"), ctx);
  await events["session.ended"]({ data: { outcome: "failed" } }, ctx);
  assert.equal(sends.length, 3);
  for (const send of sends) assert.equal(send[2].replyToMessageId, "bound-message-test");
});


test("cold event workers await Chat initialization before replies and failure notices", async () => {
  for (const [channel, event, payload] of [
    ["email", "content.completed", reply()],
    ["sms", "turn.settled", settled("failed")],
    ["email", "session.ended", { data: { outcome: "failed" } }],
    ["a2a", "turn.settled", settled("failed")],
    ["a2a", "session.ended", { data: { outcome: "failed" } }],
  ]) {
    const { events, ctx, sends } = fixture(channel);
    await events[event](payload, ctx);
    assert.equal(sends.length, 1);
  }
});

test("failed Chat initialization prevents sends and terminal state changes", async () => {
  for (const [channel, event, payload] of [
    ["email", "content.completed", reply()],
    ["sms", "turn.settled", settled("failed")],
    ["email", "session.ended", { data: { outcome: "failed" } }],
    ["a2a", "turn.settled", settled("failed")],
    ["a2a", "session.ended", { data: { outcome: "failed" } }],
  ]) {
    const { events, ctx, sends } = fixture(channel);
    ctx.channel.bot.initialize = async () => { throw new Error("state connection unavailable"); };
    await assert.rejects(events[event](payload, ctx), /state connection unavailable/);
    assert.equal(sends.length, 0);
    assert.equal(ctx.channel.state.inkboxA2ATerminal, undefined);
  }
});


test("a fresh Chat instance delivers a deferred keyed email without a prior webhook", async () => {
  const adapter = createInkboxAdapter({ apiKey: "test-key", agentHandle: "test-agent", signingSecret: "test-secret" });
  const records = new Map();
  let connected = false;
  const state = {
    connect: async () => { connected = true; },
    get: async key => { assert.equal(connected, true); return records.get(key) ?? null; },
    setIfNotExists: async (key, value) => {
      assert.equal(connected, true);
      if (records.has(key)) return false;
      records.set(key, value);
      return true;
    },
  };
  const bot = new Chat({ userName: "test-agent", adapters: { inkbox: adapter }, state });
  const route = { identityId: "identity-test", channel: "email", emailAddress: "assistant@example.com", threadId: "mail-thread" };
  const threadId = adapter.encodeThreadId(route);
  adapter.transport.prepareEmailReply = async value => value;
  const sends = [];
  adapter.transport.send = async (...args) => { sends.push(args); return { id: "reply-test", raw: {} }; };
  const ctx = {
    channel: { bot, thread: { id: threadId, toJSON: () => ({ currentMessage: { id: "source-message" } }) }, state: {} },
    session: { id: "session-test", turn: { id: "turn-test" } },
  };
  await inkboxChannelEvents(adapter)["content.completed"](reply(), ctx);
  assert.equal(connected, true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0][0].anchorMessageId, "source-message");
  assert.equal(records.size, 1);
});
