import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseSlackFilterFlag } from "../dist/commands/webhook.js";
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const f = JSON.parse(
  await readFile(
    new URL("../../tests/fixtures/slack.json", import.meta.url),
    "utf8",
  ),
);
function run(args) {
  return new Promise((resolve) =>
    execFile(
      process.execPath,
      [cli, ...args],
      { env: { ...process.env, NODE_USE_ENV_PROXY: "0" }, timeout: 15000 },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    ),
  );
}
test("Slack CLI sends exact requests, exposes onboarding and preserves file bytes", async () => {
  const requests = [];
  let reply = {};
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString(),
    });
    res.writeHead(200, {
      "Content-Type":
        reply instanceof Buffer
          ? "application/octet-stream"
          : "application/json",
    });
    res.end(reply instanceof Buffer ? reply : JSON.stringify(reply));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const tmp = await mkdtemp(path.join(os.tmpdir(), "slack-cli-"));
  const globals = [
    "--api-key",
    "synthetic-test-key",
    "--base-url",
    `http://127.0.0.1:${server.address().port}`,
    "--json",
  ];
  const c = f.connection.id,
    i = f.connection.identity_id;
  async function check(args, response, method, url, body) {
    reply = response;
    const result = await run([...globals, ...args]);
    assert.equal(result.error, null, result.stderr);
    const request = requests.at(-1);
    assert.equal(request.method, method);
    assert.equal(request.url, url);
    if (body !== undefined) assert.deepEqual(JSON.parse(request.body), body);
    return JSON.parse(result.stdout);
  }
  try {
    await check(
      ["slack", "connection", "list", "--identity-id", i],
      { connections: [f.connection], installation_available: false },
      "GET",
      `/api/v1/slack/connections?identity_id=${i}`,
    );
    const invite = await check(
      [
        "slack",
        "invitation",
        "create",
        "--identity-id",
        i,
        "--expires-in-seconds",
        "300",
      ],
      f.invitation,
      "POST",
      "/api/v1/slack/invitations",
      { identity_id: i, expires_in_seconds: 300 },
    );
    assert.match(invite.invitationUrl, /#token=/);
    await check(
      ["slack", "invitation", "list", "--identity-id", i],
      [f.invitation],
      "GET",
      `/api/v1/slack/invitations?identity_id=${i}`,
    );
    await check(
      ["slack", "invitation", "revoke", f.invitation.id],
      f.invitation,
      "POST",
      `/api/v1/slack/invitations/${f.invitation.id}/revoke`,
    );
    await check(
      ["slack", "connection", "disconnect", "--connection-id", c],
      f.connection,
      "POST",
      `/api/v1/slack/connections/${c}/disconnect`,
    );
    await check(
      ["slack", "conversation", "list", "--connection-id", c],
      { conversations: [], next_cursor: "next" },
      "GET",
      `/api/v1/slack/connections/${c}/conversations?limit=100`,
    );
    await check(
      [
        "slack",
        "conversation",
        "get",
        "--connection-id",
        c,
        "--conversation-id",
        "CEXAMPLE",
      ],
      { id: "CEXAMPLE" },
      "GET",
      `/api/v1/slack/connections/${c}/conversations/CEXAMPLE`,
    );
    await check(
      [
        "slack",
        "conversation",
        "open",
        "--connection-id",
        c,
        "--user-id",
        "UALICE",
        "--user-id",
        "UBOB",
      ],
      { id: "DEXAMPLE" },
      "POST",
      `/api/v1/slack/connections/${c}/conversations`,
      { user_ids: ["UALICE", "UBOB"] },
    );
    await check(
      [
        "slack",
        "message",
        "list",
        "--connection-id",
        c,
        "--conversation-id",
        "CEXAMPLE",
        "--thread-ts",
        "1780000000.000001",
      ],
      { messages: [], next_cursor: null, has_more: false },
      "GET",
      `/api/v1/slack/connections/${c}/conversations/CEXAMPLE/messages?limit=15&thread_ts=1780000000.000001`,
    );
    const action = await check(
      [
        "slack",
        "message",
        "send",
        "--connection-id",
        c,
        "--conversation-id",
        "CEXAMPLE",
        "--text",
        "Hello",
        "--idempotency-key",
        "operation:1",
      ],
      f.action,
      "POST",
      `/api/v1/slack/connections/${c}/messages`,
      { conversation_id: "CEXAMPLE", text: "Hello" },
    );
    assert.equal(action.status, "unknown");
    assert.equal(requests.at(-1).headers["idempotency-key"], "operation:1");
    await check(
      ["slack", "action", "get", f.action.id, "--connection-id", c],
      f.action,
      "GET",
      `/api/v1/slack/connections/${c}/actions/${f.action.id}`,
    );
    await check(
      ["slack", "file", "get", "FEXAMPLE", "--connection-id", c],
      f.file,
      "GET",
      `/api/v1/slack/connections/${c}/files/FEXAMPLE`,
    );
    const destination = path.join(tmp, "example.bin");
    await check(
      [
        "slack",
        "file",
        "download",
        "FEXAMPLE",
        "--connection-id",
        c,
        "--output",
        destination,
      ],
      Buffer.from([0, 255, 128, 1]),
      "GET",
      `/api/v1/slack/connections/${c}/files/FEXAMPLE/content`,
    );
    assert.deepEqual(
      await readFile(destination),
      Buffer.from([0, 255, 128, 1]),
    );
    await check(
      [
        "webhook",
        "subscription",
        "create",
        "--agent-identity-id",
        i,
        "--url",
        "https://example.com/hook",
        "--event-type",
        "slack.message_received",
        "--slack-filter",
        '{"messageKinds":["mention"]}',
      ],
      f.subscription,
      "POST",
      "/api/v1/webhooks/subscriptions",
      {
        agent_identity_id: i,
        url: "https://example.com/hook",
        event_types: ["slack.message_received"],
        slack_filter: { message_kinds: ["mention"] },
      },
    );
    await check(
      [
        "webhook",
        "subscription",
        "update",
        f.subscription.id,
        "--slack-filter",
        "null",
      ],
      f.subscription,
      "PATCH",
      `/api/v1/webhooks/subscriptions/${f.subscription.id}`,
      { slack_filter: null },
    );
    await check(
      [
        "webhook",
        "subscription",
        "update",
        f.subscription.id,
        "--url",
        "https://example.com/new",
      ],
      f.subscription,
      "PATCH",
      `/api/v1/webhooks/subscriptions/${f.subscription.id}`,
      { url: "https://example.com/new" },
    );
    assert.equal(requests.length, 16);
    const rejected = await run([
      ...globals,
      "slack",
      "message",
      "send",
      "--connection-id",
      c,
      "--conversation-id",
      "CEXAMPLE",
      "--text",
      "Hello",
    ]);
    assert.ok(rejected.error);
    assert.match(rejected.stderr, /idempotency-key/);
    assert.equal(requests.length, 16);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(tmp, { recursive: true, force: true });
  }
});
test("filter flags distinguish omitted, clear and explicit empty invalid shapes", () => {
  assert.equal(parseSlackFilterFlag(), undefined);
  assert.equal(parseSlackFilterFlag("null"), null);
  assert.deepEqual(parseSlackFilterFlag("{}"), {});
  assert.throws(() => parseSlackFilterFlag("[]"));
});
