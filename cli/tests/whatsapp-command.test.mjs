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
      buildWhatsAppSendOptions({ to: "+15555550101,+15555550102", text: "hi" }),
    /one recipient/,
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
  assert.equal((await run("limits")).limits["whatsapp.future_limit"], 7);
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
});
