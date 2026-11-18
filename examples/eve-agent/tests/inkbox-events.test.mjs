import assert from "node:assert/strict";
import { test } from "node:test";
import { Chat } from "chat";
import { emptySessionView, foldEvents } from "eve/events";
import { createInkboxAdapter } from "@inkbox/chat-sdk-adapter";
import { a2aInputAuth, inkboxChannelEvents } from "../agent/lib/inkbox-events.ts";

function fixture(channel = "a2a") {
  const sends = [];
  let initialized = false;
  const bot = { initialize: async () => { await Promise.resolve(); initialized = true; } };
  const adapter = {
    decodeThreadId: () => ({ channel }),
    send: async (...args) => { assert.equal(initialized, true, "initialize must finish before sending"); sends.push(args); },
  };
  const ctx = { channel: { bot, thread: { id: "thread-test", toJSON: () => ({ currentMessage: { id: "bound-message-test" } }) }, state: channel === "a2a" ? { "inkbox:task:turn-test": "task-test" } : {} }, session: { id: "session-test", turn: { id: "turn-test" } } };
  return { events: inkboxChannelEvents(adapter), sends, ctx };
}
const reply = (text = "Task result", turnId = "turn-test") => ({ scope: { turnId }, data: { kind: "text", phase: "reply", value: text, partId: "part-test" } });
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
    assert.equal(ctx.channel.state["inkbox:terminal:task-test"], undefined);
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

function viewOf(facts) {
  return foldEvents(emptySessionView(), facts.map((fact, index) => ({
    ...fact,
    meta: { position: { line: 0, index }, at: "2026-01-01T00:00:00.000Z", endOfLine: index === facts.length - 1 },
  })));
}
function taskFacts(taskId, turnId, deliveryId = `delivery-${taskId}`) {
  const auth = a2aInputAuth("thread-test", taskId);
  return [
    { type: "delivery.admitted", data: { deliveryId, principal: { id: auth.principalId, issuer: auth.issuer, type: auth.principalType } } },
    { type: "turn.started", data: { turnId, cause: { deliveryId }, follows: null } },
    { type: "delivery.consumed", data: { deliveryId, turnId, parts: [{ kind: "text", text: "Request" }] } },
  ];
}
async function bindTask(events, ctx, taskId, turnId) {
  const facts = taskFacts(taskId, turnId);
  ctx.view = viewOf(facts);
  await events["turn.started"](facts[1], ctx);
  await events["delivery.consumed"](facts[2], ctx);
}

test("two tasks share a context without sharing terminal state or delayed reply destinations", async () => {
  const { events, ctx, sends } = fixture();
  ctx.channel.state = {};
  await bindTask(events, ctx, "task-first", "turn-first");
  await bindTask(events, ctx, "task-second", "turn-second");
  ctx.session.turn.id = "turn-second";
  ctx.channel.thread.toJSON = () => ({ currentMessage: { raw: { route: { taskId: "task-second" } } } });
  await events["content.completed"](reply("First answer", "turn-first"), ctx);
  await events["turn.settled"]({ data: { turnId: "turn-first", outcome: "completed", reply: ["part-test"] } }, ctx);
  await events["content.completed"](reply("Second answer", "turn-second"), ctx);
  await events["turn.settled"]({ data: { turnId: "turn-second", outcome: "completed", reply: ["part-test"] } }, ctx);
  assert.deepEqual(sends.map(send => [send[1], send[2].a2aTaskId]), [["First answer", "task-first"], ["Second answer", "task-second"]]);
  assert.equal(ctx.channel.state["inkbox:terminal:task-first"], true);
  assert.equal(ctx.channel.state["inkbox:terminal:task-second"], true);
});

test("a task cannot replace another task's turn binding", async () => {
  const { events, ctx } = fixture();
  await bindTask(events, ctx, "task-first", "turn-first");
  const facts = taskFacts("task-second", "turn-first");
  ctx.view = viewOf(facts);
  await assert.rejects(events["delivery.consumed"](facts[2], ctx), /cannot consume another task/);
  assert.equal(ctx.channel.state["inkbox:task:turn-first"], "task-first");
});

test("missing or cross-context task authority fails closed", async () => {
  const { events, ctx, sends } = fixture();
  const facts = taskFacts("task-first", "turn-first");
  facts[0].data.principal.id = JSON.stringify(["another-thread", "task-first"]);
  ctx.view = viewOf(facts);
  await assert.rejects(events["turn.started"](facts[1], ctx), /does not match/);
  delete ctx.channel.state["inkbox:task:turn-test"];
  await assert.rejects(events["turn.settled"](settled("completed"), ctx), /Missing A2A task binding/);
  assert.equal(sends.length, 0);
});

test("approval prompts keep numbered choices and their originating task", async () => {
  const { events, ctx, sends } = fixture();
  await bindTask(events, ctx, "task-first", "turn-first");
  await bindTask(events, ctx, "task-second", "turn-second");
  ctx.session.turn.id = "turn-second";
  const prompt = { type: "interaction.opened", scope: { turnId: "turn-first" }, data: {
    interactionId: "approval-first", subject: { turnId: "turn-first" },
    request: { kind: "approval", prompt: "Proceed?", options: [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }] },
  } };
  ctx.view = viewOf([...taskFacts("task-first", "turn-first"), prompt]);
  await events.committed({}, ctx);
  await events.committed({}, ctx);
  assert.equal(sends.length, 1);
  assert.match(sends[0][1], /1\. Approve/);
  assert.match(sends[0][1], /2\. Deny/);
  assert.equal(sends[0][2].a2aIntent, "ask_caller");
  assert.equal(sends[0][2].a2aTaskId, "task-first");
  assert.notEqual(a2aInputAuth("thread-test", "task-first").principalId, a2aInputAuth("thread-test", "task-second").principalId);
});

test("sign-in prompts retain their task without exposing callback URLs", async () => {
  const { events, ctx, sends } = fixture();
  await bindTask(events, ctx, "task-first", "turn-first");
  const prompt = { type: "interaction.opened", scope: { turnId: "turn-first" }, data: {
    interactionId: "signin-first", subject: { turnId: "turn-first" },
    request: { kind: "sign-in", prompt: "Sign in to continue", signIn: { name: "example", url: "https://example.com/login", callbackUrl: "https://example.com/private-callback" } },
  } };
  ctx.view = viewOf([...taskFacts("task-first", "turn-first"), prompt]);
  await events["interaction.opened"](prompt, ctx);
  assert.equal(sends[0][2].a2aTaskId, "task-first");
  assert.equal(sends[0][2].a2aIntent, "ask_caller");
  assert.match(sends[0][1], /https:\/\/example.com\/login/);
  assert.doesNotMatch(sends[0][1], /private-callback/);
});


test("email interaction prompts retain their bound reply audience", async () => {
  const { events, ctx, sends } = fixture("email");
  const approval = { type: "interaction.opened", scope: { turnId: "turn-test" }, data: {
    interactionId: "approval-email", subject: { turnId: "turn-test" },
    request: { kind: "approval", prompt: "Proceed?", options: [{ id: "approve", label: "Approve" }] },
  } };
  ctx.view = viewOf([...taskFacts("task-test", "turn-test"), approval]);
  await events.committed({}, ctx);
  const signIn = { type: "interaction.opened", scope: { turnId: "turn-test" }, data: {
    interactionId: "signin-email", subject: { turnId: "turn-test" },
    request: { kind: "sign-in", prompt: "Sign in", signIn: { name: "example", url: "https://example.com/login" } },
  } };
  ctx.view = viewOf([...taskFacts("task-test", "turn-test"), signIn]);
  await events["interaction.opened"](signIn, ctx);
  assert.equal(sends.length, 2);
  for (const send of sends) assert.equal(send[2].replyToMessageId, "bound-message-test");
});
