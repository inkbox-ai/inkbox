import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const f = JSON.parse(
  await readFile(
    new URL("../../tests/fixtures/slack.json", import.meta.url),
    "utf8",
  ),
);
function run(args, stdin) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [cli, ...args],
      { env: { ...process.env, NODE_USE_ENV_PROXY: "0" }, timeout: 15000 },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    );
    child.stdin.end(stdin);
  });
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
    const setup = await check(
      ["slack", "setup", "start", "--identity-id", i, "--provisioning-workspace-id", f.provisioning_workspace.id],
      { status: "pending", retry_at: "2026-10-01T12:00:00Z", error_code: null },
      "POST", "/api/v1/slack/applications/setup", { identity_id: i, provisioning_workspace_id: f.provisioning_workspace.id },
    );
    assert.equal(setup.status, "pending");
    assert.equal(setup.retryAt, "2026-10-01T12:00:00.000Z");
    await check(
      ["slack", "connection", "list", "--identity-id", i],
      { connections: [f.connection], installation_available: false },
      "GET",
      `/api/v1/slack/connections?identity_id=${i}`,
    );
    const credentialsFile = path.join(tmp, "credentials.json");
    await writeFile(credentialsFile, JSON.stringify({ access_token: "synthetic-access", refresh_token: "synthetic-refresh" }), { mode: 0o600 });
    const workspace = await check(
      ["slack", "provisioning-workspace", "save", "--credentials-file", credentialsFile],
      f.provisioning_workspace, "POST", "/api/v1/slack/provisioning-workspaces",
      { access_token: "synthetic-access", refresh_token: "synthetic-refresh" },
    );
    assert.equal(workspace.workspaceId, "TEXAMPLE");
    assert.equal(workspace.accessToken, undefined);
    await check(
      ["slack", "provisioning-workspace", "list"],
      { workspaces: [f.provisioning_workspace] }, "GET", "/api/v1/slack/provisioning-workspaces",
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
    for (const event of ["slack.dm_received", "slack.group_dm_received", "slack.channel_message_received",
      "slack.mention_received", "slack.thread_reply_received"]) {
      await check(
        ["webhook", "subscription", "create", "--agent-identity-id", i,
          "--url", "https://example.com/hook", "--event-type", event],
        f.subscription, "POST", "/api/v1/webhooks/subscriptions",
        { agent_identity_id: i, url: "https://example.com/hook", event_types: [event] },
      );
      await check(
        ["webhook", "subscription", "update", f.subscription.id, "--event-type", event],
        f.subscription, "PATCH", `/api/v1/webhooks/subscriptions/${f.subscription.id}`,
        { event_types: [event] },
      );
    }
    await check(
      ["webhook", "subscription", "create", "--agent-identity-id", i,
        "--url", "https://example.com/hook", "--event-type", "slack.mention_received",
        "--event-type", "message.received", "--context-email", "count:1"],
      f.subscription, "POST", "/api/v1/webhooks/subscriptions",
      {agent_identity_id: i, url: "https://example.com/hook",
        event_types: ["slack.mention_received", "message.received"],
        context_config: {email: {mode: "count", count: 1}}},
    );
    await check(
      ["webhook", "subscription", "update", f.subscription.id, "--scope", "identity",
        "--event-type", "slack.mention_received", "--event-type", "message.received"],
      f.subscription, "PATCH", `/api/v1/webhooks/subscriptions/${f.subscription.id}?scope=identity`,
      {event_types: ["slack.mention_received", "message.received"]},
    );
    for (const action of ["create", "update"]) {
      const args = action === "create"
        ? ["create", "--agent-identity-id", i, "--url", "https://example.com/hook", "--event-type", "slack.mention_received"]
        : ["update", f.subscription.id];
      const rejectedFilter = await run([...globals, "webhook", "subscription", ...args,
        "--slack-filter", '{"messageKinds":["mention"]}']);
      assert.ok(rejectedFilter.error);
      assert.match(rejectedFilter.stderr, /unknown option.*--slack-filter/);
    }
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
    assert.equal(requests.length, 26);
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
    assert.equal(requests.length, 26);
    const missingRecipient = await run([
      ...globals,
      "slack",
      "conversation",
      "open",
      "--connection-id",
      c,
    ]);
    assert.ok(missingRecipient.error);
    assert.match(missingRecipient.stderr, /required option.*--user-id/);
    assert.equal(requests.length, 26);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(tmp, { recursive: true, force: true });
  }
});
test("identity-scoped Slack commands resolve handles and reject ambiguous selectors before dispatch", async () => {
  const requests = [];
  let reply = {};
  let identityStatus = 200;
  const identityId = f.connection.identity_id;
  const identity = {
    id: identityId,
    organization_id: "org_test",
    agent_handle: "example-agent",
    email_address: null,
    created_at: "2026-09-16T00:00:00Z",
    updated_at: "2026-09-16T00:00:00Z",
  };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    requests.push({
      method: req.method,
      url: req.url,
      body: body ? JSON.parse(body) : null,
    });
    const lookup = req.url === "/api/v1/identities/example-agent";
    res.writeHead(lookup ? identityStatus : 200, {
      "Content-Type": "application/json",
    });
    res.end(
      JSON.stringify(
        lookup
          ? identityStatus === 200
            ? identity
            : { detail: "Not found" }
          : reply,
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const globals = [
    "--api-key",
    "synthetic-test-key",
    "--base-url",
    `http://127.0.0.1:${server.address().port}`,
    "--json",
    "slack",
  ];
  const cases = [
    {
      args: ["setup", "start", "--provisioning-workspace-id", f.provisioning_workspace.id],
      response: { status: "ready", retry_at: null, error_code: null },
      method: "POST",
      url: "/api/v1/slack/applications/setup",
      body: { identity_id: identityId, provisioning_workspace_id: f.provisioning_workspace.id },
    },
    {
      args: ["search", "--q", "message"],
      response: { messages: [], next_cursor: "next", source: "archive" },
      method: "GET",
      url: `/api/v1/slack/search?limit=50&q=message&identity_id=${identityId}`,
      body: null,
      identityOptional: true,
    },
    {
      args: ["connection", "list"],
      response: { connections: [], installation_available: false },
      method: "GET",
      url: `/api/v1/slack/connections?identity_id=${identityId}`,
      body: null,
    },
    {
      args: ["installation", "start", "--workspace-id", "TEXAMPLE"],
      response: {
        authorization_url: "https://example.com/opaque-handoff",
        expires_at: "2026-09-16T00:15:00Z",
      },
      method: "POST",
      url: "/api/v1/slack/installations",
      body: { identity_id: identityId, workspace_id: "TEXAMPLE" },
    },
  ];
  try {
    for (const item of cases) {
      for (const selectors of [
        [],
        ["--identity", "example-agent", "--identity-id", identityId],
      ]) {
        if (item.identityOptional && selectors.length === 0) continue;
        const before = requests.length;
        const invalid = await run([...globals, ...item.args, ...selectors]);
        assert.ok(invalid.error);
        assert.match(
          invalid.stderr,
          /exactly one of --identity or --identity-id/,
        );
        assert.equal(requests.length, before);
      }
      reply = item.response;
      for (const flag of ["--identity", "-i"]) {
        const result = await run([
          ...globals,
          ...item.args,
          flag,
          "example-agent",
        ]);
        assert.equal(result.error, null, result.stderr);
        assert.deepEqual(requests.at(-2), {
          method: "GET",
          url: "/api/v1/identities/example-agent",
          body: null,
        });
        assert.deepEqual(requests.at(-1), {
          method: item.method,
          url: item.url,
          body: item.body,
        });
      }
    }
    identityStatus = 404;
    const before = requests.length;
    const missingIdentity = await run([
      ...globals,
      "installation",
      "start",
      "-i",
      "example-agent",
    ]);
    assert.ok(missingIdentity.error);
    assert.equal(requests.length, before + 1); // Failed lookup must not start installation.
    assert.equal(requests.at(-1).url, "/api/v1/identities/example-agent");
    const beforeSearch = requests.length;
    const failedSearch = await run([...globals, "search", "--q", "message", "--identity", "example-agent"]);
    assert.ok(failedSearch.error);
    assert.equal(requests.length, beforeSearch + 1);
    assert.equal(requests.at(-1).url, "/api/v1/identities/example-agent");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test("Slack provisioning credentials use stdin or a file without leaking errors", async () => {
  const requests = [];
  let responseStatus = 200;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(responseStatus, { "Content-Type": "application/json" });
    res.end(JSON.stringify(responseStatus === 200 ? f.provisioning_workspace : {
      detail: { error: "invalid_credentials", message: "synthetic-access synthetic-refresh" },
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const args = ["--api-key", "synthetic-test-key", "--base-url", `http://127.0.0.1:${server.address().port}`, "--json",
    "slack", "provisioning-workspace", "save", "--credentials-file", "-"];
  const credentials = { access_token: "synthetic-access", refresh_token: "synthetic-refresh" };
  try {
    const success = await run(args, JSON.stringify(credentials));
    assert.equal(success.error, null, success.stderr);
    assert.deepEqual(requests, [credentials]);
    assert.equal(JSON.parse(success.stdout).workspaceId, "TEXAMPLE");
    responseStatus = 422;
    const failed = await run(args, JSON.stringify(credentials));
    assert.ok(failed.error);
    assert.doesNotMatch(failed.stderr + failed.stdout, /synthetic-access|synthetic-refresh/);
    assert.match(failed.stderr, /invalid_credentials/);
    const before = requests.length;
    for (const raw of ["{synthetic-access", JSON.stringify({ access_token: "synthetic-access" }), "[]", "x".repeat(17000)]) {
      const invalid = await run(args, raw);
      assert.ok(invalid.error);
      assert.doesNotMatch(invalid.stderr + invalid.stdout, /synthetic-access|synthetic-refresh/);
    }
    assert.equal(requests.length, before);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Slack CLI exposes retry delay and recovers by key without sending again", async () => {
  const requests = [];
  const failed = { ...f.action, status: "failed", error_code: "rate_limited" };
  let reply = { ...failed, retry_after: 73 };
  let status = 200;
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume the request */ }
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const globals = ["--api-key", "synthetic-test-key", "--base-url",
    `http://127.0.0.1:${server.address().port}`, "--json"];
  const connection = ["--connection-id", f.connection.id];
  try {
    const sent = await run([...globals, "slack", "message", "send", ...connection,
      "--conversation-id", "CEXAMPLE", "--text", "Hello", "--idempotency-key", "original:1"]);
    assert.equal(sent.error, null, sent.stderr);
    assert.equal(JSON.parse(sent.stdout).retryAfter, 73);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    reply = failed;
    const lookup = [...globals, "slack", "action", "get-by-key", ...connection,
      "--idempotency-key", "original:1"];
    const recovered = await run(lookup);
    assert.equal(recovered.error, null, recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).id, failed.id);
    assert.equal(JSON.parse(recovered.stdout).retryAfter, null);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].method, "GET");
    assert.equal(requests[1].url, `/api/v1/slack/connections/${f.connection.id}/actions/by-key`);
    assert.equal(requests[1].headers["idempotency-key"], "original:1");
    reply = { detail: "Slack action not found" };
    status = 404;
    const missing = await run(lookup);
    assert.notEqual(missing.error, null);
    assert.equal(requests.length, 3);
    assert.equal(requests[2].method, "GET");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
