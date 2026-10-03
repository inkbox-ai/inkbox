import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Command } from "commander";
import {
  buildIMessageSendOptions,
  IMESSAGE_SENDABLE_REACTIONS,
  registerIMessageCommands,
} from "../dist/commands/imessage.js";

test("iMessage reaction choices match the named outbound allowlist", () => {
  assert.deepEqual(IMESSAGE_SENDABLE_REACTIONS, [
    "love",
    "like",
    "dislike",
    "laugh",
    "emphasize",
    "question",
    "eyes",
  ]);
  assert.equal(IMESSAGE_SENDABLE_REACTIONS.includes("custom"), false);
  assert.equal(IMESSAGE_SENDABLE_REACTIONS.includes("🔥"), false);

  const program = new Command();
  registerIMessageCommands(program);
  const imessage = program.commands.find((command) => command.name() === "imessage");
  const react = imessage?.commands.find((command) => command.name() === "react");
  const reactionOption = react?.options.find((option) => option.long === "--reaction");
  assert.deepEqual(reactionOption?.argChoices, IMESSAGE_SENDABLE_REACTIONS);
  assert.equal(reactionOption?.mandatory, true);
});

test("iMessage unreact is registered and requires an identity", () => {
  const program = new Command();
  registerIMessageCommands(program);
  const imessage = program.commands.find((command) => command.name() === "imessage");
  const unreact = imessage?.commands.find((command) => command.name() === "unreact");
  assert.ok(unreact, "unreact command is registered");
  assert.equal(unreact?.registeredArguments?.[0]?.name(), "reaction-id");
  const identity = unreact?.options.find((option) => option.long === "--identity");
  assert.equal(identity?.mandatory, true);
});

test("buildIMessageSendOptions preserves a scalar recipient", () => {
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    to: " +15551234567 ",
    text: "Hello",
  }), { sendOptions: { to: "+15551234567", text: "Hello" } });
});

test("buildIMessageSendOptions builds a group send", () => {
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    to: "+15551234567, +15557654321",
    text: "Hello group",
    mediaUrl: "https://example.com/photo.jpg",
    sendStyle: "confetti",
  }), {
    sendOptions: {
      to: ["+15551234567", "+15557654321"],
      text: "Hello group",
      mediaUrls: ["https://example.com/photo.jpg"],
      sendStyle: "confetti",
    },
  });
});

test("buildIMessageSendOptions builds a conversation reply", () => {
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    conversationId: "eeee1111-0000-0000-0000-0000000000fa",
    text: "Reply",
    mediaUrl: "https://example.com/reply.jpg",
    sendStyle: "lasers",
  }), {
    sendOptions: {
      conversationId: "eeee1111-0000-0000-0000-0000000000fa",
      text: "Reply",
      mediaUrls: ["https://example.com/reply.jpg"],
      sendStyle: "lasers",
    },
  });
});

test("buildIMessageSendOptions rejects conflicting destinations", () => {
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    to: "+15551234567",
    conversationId: "eeee1111-0000-0000-0000-0000000000fa",
    text: "Hello",
  }), { error: "Pass either --to or --conversation-id, not both." });
});

test("buildIMessageSendOptions rejects missing destination or content", () => {
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    text: "Hello",
  }), { error: "Pass --to or --conversation-id." });
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    to: "+15551234567",
  }), { error: "Pass --text, --media-url, or both." });
});

test("threaded replies require a conversation and retain the message target", () => {
  assert.deepEqual(buildIMessageSendOptions({ identity: "support-bot", conversationId: "conversation", replyToMessageId: "message", text: "Agreed" }), {
    sendOptions: { conversationId: "conversation", replyToMessageId: "message", plainReplyFallback: true, text: "Agreed" },
  });
  assert.deepEqual(buildIMessageSendOptions({ identity: "support-bot", to: "+15550100101", replyToMessageId: "message", text: "Agreed" }), {
    error: "--reply-to-message-id requires --conversation-id.",
  });
});

test("thread commands expose cursor pagination and conversation list filtering", () => {
  const program = new Command();
  registerIMessageCommands(program);
  const imessage = program.commands.find((command) => command.name() === "imessage");
  for (const name of ["thread", "conversation-thread"]) {
    const command = imessage.commands.find((command) => command.name() === name);
    assert.ok(command);
    assert.ok(command.options.some((option) => option.long === "--cursor"));
    assert.equal(command.options.some((option) => option.long === "--offset"), false);
    assert.ok(command.options.find((option) => option.long === "--identity").mandatory);
  }
  for (const name of ["list", "conversation"]) {
    assert.ok(imessage.commands.find((command) => command.name() === name).options.some((option) => option.long === "--thread-id"));
  }
});


test("an empty explicit reply target never becomes an ordinary message", () => {
  assert.deepEqual(buildIMessageSendOptions({ identity: "support-bot", conversationId: "conversation", replyToMessageId: "", text: "Agreed" }), {
    error: "--reply-to-message-id must not be empty.",
  });
});


test("plain fallback flag defaults on and can require native threading", () => {
  for (const strict of [false, true]) {
    const program = new Command();
    registerIMessageCommands(program);
    const send = program.commands.find((command) => command.name() === "imessage")
      .commands.find((command) => command.name() === "send");
    let parsed;
    send.action((options) => { parsed = buildIMessageSendOptions(options); });
    send.parse(["--identity", "support-bot", "--conversation-id", "conversation",
      "--reply-to-message-id", "message", "--text", "Agreed", ...(strict ? ["--no-plain-reply-fallback"] : [])], { from: "user" });
    assert.deepEqual(parsed, { sendOptions: { conversationId: "conversation",
      replyToMessageId: "message", plainReplyFallback: !strict, text: "Agreed" } });
  }
});

test("ordinary sends omit default fallback but reject an explicit strict flag", () => {
  for (const plainReplyFallback of [undefined, true]) {
    assert.deepEqual(buildIMessageSendOptions({ identity: "support-bot", conversationId: "conversation", text: "Hello", plainReplyFallback }), {
      sendOptions: { conversationId: "conversation", text: "Hello" },
    });
  }
  assert.deepEqual(buildIMessageSendOptions({ identity: "support-bot", conversationId: "conversation", text: "Hello", plainReplyFallback: false }), {
    error: "--no-plain-reply-fallback requires --reply-to-message-id.",
  });
});

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const exec = promisify(execFile);
const identityId = "10000000-0000-0000-0000-000000000001";
const conversationId = "20000000-0000-0000-0000-000000000002";
const threadId = "30000000-0000-0000-0000-000000000003";
const messageId = "40000000-0000-0000-0000-000000000004";

async function withIMessageServer(t) {
  const calls = [];
  const message = { id: messageId, conversation_id: conversationId, assignment_id: null,
    direction: "inbound", content: "Hello", message_type: "message", service: "imessage",
    status: "received", is_read: false, reply_to_message_id: null, thread_id: threadId,
    thread_root_message_id: messageId, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
  const page = { conversation_id: conversationId, thread_id: threadId,
    thread_root_message_id: messageId, messages: [message], next_cursor: "next+/=" };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    calls.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
    response.setHeader("content-type", "application/json");
    if (url.pathname === "/api/v1/identities/support-bot") {
      response.end(JSON.stringify({ id: identityId, organization_id: "org_example", agent_handle: "support-bot",
        imessage_enabled: true, created_at: message.created_at, updated_at: message.updated_at }));
    } else if (url.pathname === "/api/v1/imessage/messages") {
      response.end(JSON.stringify([message]));
    } else {
      response.end(JSON.stringify(page));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const run = (...args) => exec(process.execPath, [cli, "--base-url", `http://127.0.0.1:${server.address().port}`,
    "--api-key", "test-only", "--json", "imessage", ...args, "--identity", "support-bot"],
  { env: { ...process.env, NODE_USE_ENV_PROXY: "0" }, timeout: 10000 });
  return { calls, run };
}

test("thread commands forward scoped cursors and return usable chronological pages", async (t) => {
  const { calls, run } = await withIMessageServer(t);
  const first = JSON.parse((await run("thread", messageId, "--limit", "2")).stdout);
  assert.equal(first.messages[0].id, messageId);
  assert.equal(first.messages[0].threadRootMessageId, messageId);
  assert.equal(first.nextCursor, "next+/=");
  const second = JSON.parse((await run("thread", messageId, "--limit", "2", "--cursor", first.nextCursor)).stdout);
  assert.equal(second.threadId, threadId);
  const byConversation = JSON.parse((await run("conversation-thread", conversationId, threadId,
    "--limit", "3", "--cursor", first.nextCursor)).stdout);
  assert.equal(byConversation.conversationId, conversationId);
  assert.equal(byConversation.messages[0].replyToMessageId, null);
  assert.deepEqual(calls, [
    { method: "GET", path: "/api/v1/identities/support-bot", query: {} },
    { method: "GET", path: `/api/v1/imessage/messages/${messageId}/thread`,
      query: { agent_identity_id: identityId, limit: "2" } },
    { method: "GET", path: "/api/v1/identities/support-bot", query: {} },
    { method: "GET", path: `/api/v1/imessage/messages/${messageId}/thread`,
      query: { agent_identity_id: identityId, limit: "2", cursor: "next+/=" } },
    { method: "GET", path: "/api/v1/identities/support-bot", query: {} },
    { method: "GET", path: `/api/v1/imessage/conversations/${conversationId}/threads/${threadId}`,
      query: { agent_identity_id: identityId, limit: "3", cursor: "next+/=" } },
  ]);
});

test("thread-filtered lists preserve offset pagination and identity scope", async (t) => {
  const { calls, run } = await withIMessageServer(t);
  for (const args of [["list", "--conversation-id", conversationId], ["conversation", conversationId]]) {
    const messages = JSON.parse((await run(...args, "--thread-id", threadId, "--limit", "4", "--offset", "8")).stdout);
    assert.equal(messages[0].threadId, threadId);
    assert.deepEqual(calls.at(-1), { method: "GET", path: "/api/v1/imessage/messages",
      query: { agent_identity_id: identityId, conversation_id: conversationId, thread_id: threadId, limit: "4", offset: "8" } });
  }
});

test("invalid thread flag combinations fail before any identity or message request", async (t) => {
  const { calls, run } = await withIMessageServer(t);
  await assert.rejects(run("list", "--thread-id", threadId), error => {
    assert.match(error.stderr, /--thread-id requires --conversation-id/);
    return true;
  });
  await assert.rejects(run("send", "--conversation-id", conversationId, "--text", "Hello", "--no-plain-reply-fallback"), error => {
    assert.match(error.stderr, /--no-plain-reply-fallback requires --reply-to-message-id/);
    return true;
  });
  assert.deepEqual(calls, []);
});
