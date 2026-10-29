import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildWhatsAppSendOptions } from "../dist/commands/whatsapp.js";
const f = JSON.parse(
  readFileSync(
    new URL("../../tests/fixtures/whatsapp.json", import.meta.url),
    "utf8",
  ),
);
const v2 = JSON.parse(readFileSync(new URL("../../tests/fixtures/whatsapp-v2.json", import.meta.url), "utf8"));
const exec = promisify(execFile),
  cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
test("one-to-one send selectors and owned attachment options", () => {
  assert.deepEqual(
    buildWhatsAppSendOptions({
      conversationId: f.conversation.id,
      mediaId: f.media.id,
      idempotencyKey: "stable",
    }),
    {
      conversationId: f.conversation.id,
      mediaIds: [f.media.id],
      idempotencyKey: "stable",
    },
  );
  assert.throws(
    () =>
      buildWhatsAppSendOptions({ to: "+15555550101,+15555550101", text: "hi" }),
    /unique E.164/,
  );
  assert.throws(
    () =>
      buildWhatsAppSendOptions({
        to: "+15555550101",
        conversationId: f.conversation.id,
        text: "hi",
      }),
    /exactly one/,
  );
});
test("CLI uses real SDK ownership, current delivery state, fresh media, and local read boundary", async (t) => {
  const calls = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      method: req.method,
      body: raw ? JSON.parse(raw) : null,
      key: req.headers["idempotency-key"],
    });
    res.setHeader("content-type", "application/json");
    const routes = {
      "/api/v1/identities/agent": {
        id: f.identity_id,
        organization_id: "org_example",
        agent_handle: "agent",
        created_at: f.message.created_at,
        updated_at: f.message.updated_at,
      },
      "/api/v1/identities/agent/channel-status": { whatsapp: f.status },
      "/api/v1/whatsapp/messages":
        req.method === "POST" ? { message: f.message } : [f.inbound_message],
      [`/api/v1/whatsapp/messages/${f.message.id}`]: f.message,
      "/api/v1/whatsapp/reactions": { reaction: v2.reaction },
      [`/api/v1/whatsapp/reactions/${v2.reaction.id}`]: { reaction: req.method === "DELETE" ? v2.removed_reaction : v2.reaction },
      [`/api/v1/whatsapp/messages/${v2.message.id}/thread`]: v2.thread,
      [`/api/v1/whatsapp/conversations/${v2.thread.conversation_id}/threads/${v2.thread.thread_id}`]: v2.thread,
      "/api/v1/whatsapp/limits": f.limits,
      "/api/v1/whatsapp/conversations": [f.conversation_summary],
      [`/api/v1/whatsapp/media/${f.media.id}`]: f.media,
      "/api/v1/whatsapp/mark-read": {
        conversation_id: f.conversation.id,
        updated_count: 2,
      },
    };
    if (!(url.pathname in routes)) {
      res.writeHead(404).end();
      return;
    }
    res.end(JSON.stringify(routes[url.pathname]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const run = async (...args) =>
    JSON.parse(
      (
        await exec(
          process.execPath,
          [
            cli,
            "--api-key",
            "test-only",
            "--base-url",
            `http://127.0.0.1:${server.address().port}`,
            "--json",
            "whatsapp",
            ...args,
            "--identity",
            "agent",
          ],
          { env: { ...process.env, NODE_USE_ENV_PROXY: "0" }, timeout: 10000 },
        )
      ).stdout,
    );
  const sent = await run(
    "send",
    "--conversation-id",
    f.conversation.id,
    "--text",
    "Hello",
    "--media-id",
    f.media.id,
    "--idempotency-key",
    "stable",
  );
  assert.equal(sent.status, "sent");
  assert.equal(sent.deliveryState, "unknown");
  const send = calls.find((c) => c.method === "POST");
  assert.deepEqual(send.body, {
    conversation_id: f.conversation.id,
    text: "Hello",
    media_ids: [f.media.id],
  });
  assert.equal(send.query.agent_identity_id, f.identity_id);
  assert.equal(send.key, "stable");
  assert.equal(
    (await run("list", "--conversation-id", f.conversation.id, "--unread"))[0]
      .media[0].status,
    "unavailable",
  );
  assert.equal((await run("get", f.message.id)).id, f.message.id);
  assert.equal((await run("conversations"))[0].unreadCount, 2);
  assert.equal((await run("get-media", f.media.id)).id, f.media.id);
  assert.equal((await run("status")).enabled, true);
  const limits = await run("limits");
  assert.deepEqual(Object.keys(limits).sort(), ["agentIdentityId", "limits", "usage"]);
  assert.equal(limits.limits["whatsapp.future_limit"], 7);
  assert.equal(limits.limits["whatsapp.texts_per_agent_identity_per_24h"], 1000);
  assert.deepEqual(limits.usage, { "whatsapp.texts_per_agent_identity_per_24h": 2 });
  assert.equal(calls.at(-1).query.agent_identity_id, f.identity_id);
  assert.equal(
    (
      await run(
        "mark-read",
        "--conversation-id",
        f.conversation.id,
        "--through-message-id",
        f.message.id,
      )
    ).updatedCount,
    2,
  );
  assert.deepEqual(calls.at(-1).body, {
    conversation_id: f.conversation.id,
    through_message_id: f.message.id,
  });
  await run("send", "--to", "+15555550101,+15555550102", "--group-name", "Project team", "--text", "Hello", "--idempotency-key", "group-stable");
  assert.deepEqual(calls.at(-1).body, { to: ["+15555550101", "+15555550102"], group_name: "Project team", text: "Hello" });
  await run("send", "--conversation-id", f.conversation.id, "--reply-to-message-id", v2.message.id, "--text", "Quoted", "--idempotency-key", "quote-stable");
  assert.equal(calls.at(-1).body.reply_to_message_id, v2.message.id);
  assert.equal((await run("react", v2.message.id, "--reaction", "love", "--idempotency-key", "reaction-stable")).status, "applied");
  assert.deepEqual(calls.at(-1).body, { message_id: v2.message.id, reaction: "love" });
  assert.equal(calls.at(-1).key, "reaction-stable");
  assert.equal(calls.at(-1).query.agent_identity_id, f.identity_id);
  assert.equal((await run("get-reaction", v2.reaction.id)).id, v2.reaction.id);
  assert.equal((await run("remove-reaction", v2.reaction.id, "--idempotency-key", "remove-stable")).status, "removed");
  assert.equal(calls.at(-1).method, "DELETE");
  assert.equal(calls.at(-1).key, "remove-stable");
  assert.equal((await run("thread", v2.message.id, "--cursor", "opaque+cursor")).threadId, v2.thread.thread_id);
  assert.equal(calls.at(-1).query.cursor, "opaque+cursor");
  assert.equal((await run("conversation-thread", v2.thread.conversation_id, v2.thread.thread_id)).threadRootMessageId, v2.thread.thread_root_message_id);
  await run("list", "--conversation-id", f.conversation.id, "--thread-id", v2.thread.thread_id, "--direct-only");
  assert.equal(calls.at(-1).query.include_groups, "false");
  assert.equal(calls.at(-1).query.thread_id, v2.thread.thread_id);
  await run("conversations", "--direct-only");
  assert.equal(calls.at(-1).query.include_groups, "false");
  const beforeEmptyQuote = calls.length;
  for (const selector of [["--conversation-id", f.conversation.id], ["--to", "+15555550101"]]) {
    await assert.rejects(() => run("send", ...selector, "--reply-to-message-id", "", "--text", "Do not silently send plain"));
  }
  assert.equal(calls.length, beforeEmptyQuote);
});

test("shared group selectors, quoted replies, and creation-only names", () => {
  for (const item of v2.send_cases) {
    const body = item.body;
    const options = { to: Array.isArray(body.to) ? body.to.join(",") : body.to, conversationId: body.conversation_id, replyToMessageId: body.reply_to_message_id, groupName: body.group_name, text: body.text };
    if (item.valid) assert.doesNotThrow(() => buildWhatsAppSendOptions(options), item.name);
    else assert.throws(() => buildWhatsAppSendOptions(options), undefined, item.name);
  }
});

test("an explicitly empty quote target is rejected instead of becoming a plain send", () => {
  for (const selector of [{ conversationId: f.conversation.id }, { to: "+15555550101" }]) {
    assert.throws(() => buildWhatsAppSendOptions({ ...selector, replyToMessageId: "", text: "Reply" }), /requires/);
  }
  assert.deepEqual(buildWhatsAppSendOptions({ conversationId: f.conversation.id, text: "Plain" }), { conversationId: f.conversation.id, text: "Plain" });
});
