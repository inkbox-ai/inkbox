import assert from "node:assert/strict";
import { test } from "node:test";
import { createInkboxAdapter } from "@inkbox/chat-sdk-adapter";
import { inkboxChannelEvents, INKBOX_EVE_A2A_INTENT } from "../agent/lib/inkbox-events.ts";

function fixture(channel = "a2a") {
  const sends = [];
  const adapter = {
    decodeThreadId: () => ({ channel }),
    send: async (...args) => { sends.push(args); },
  };
  const ctx = { channel: { thread: { id: "thread-test", toJSON: () => ({ currentMessage: { id: "bound-message-test" } }) }, state: {} }, session: { id: "session-test", turn: { id: "turn-test" } } };
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
