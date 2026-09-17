import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const data = JSON.parse(
  await readFile(
    new URL("../../tests/fixtures/slack_operations.json", import.meta.url),
    "utf8",
  ),
);
const C = data.connection_id,
  O = data.operation_id,
  TS = data.message_ts;
const conn = ["--connection-id", C],
  conv = [...conn, "--conversation-id", "C123"],
  msg = [...conv, "--message-ts", TS],
  key = ["--idempotency-key", "stable-key"];
function commands(file) {
  return {
    start_installation: [
      "installation",
      "start",
      "--identity-id",
      C,
      "--workspace-id",
      "T123",
    ],
    capabilities: ["capabilities", ...conn],
    list_users: ["user", "list", ...conn, "--limit", "2", "--cursor", "opaque"],
    get_user: ["user", "get", ...conn, "--user-id", "U123"],
    list_members: [
      "conversation",
      "members",
      ...conv,
      "--limit",
      "2",
      "--cursor",
      "opaque",
    ],
    get_message: ["message", "get", ...msg, "--thread-ts", "1234567890.000000"],
    message_context: ["message", "context", ...msg],
    get_permalink: ["message", "permalink", ...msg],
    get_reactions: ["reaction", "get", ...msg],
    list_pins: ["pin", "list", ...conv],
    get_operation: ["operation", "get", ...conn, "--operation-id", O],
    add_reaction: ["reaction", "add", ...msg, "--name", "eyes", ...key],
    remove_reaction: ["reaction", "remove", ...msg, "--name", "eyes", ...key],
    add_pin: ["pin", "add", ...msg, ...key],
    remove_pin: ["pin", "remove", ...msg, ...key],
    update_message: ["message", "update", ...msg, "--text", "edited", ...key],
    delete_message: ["message", "delete", ...msg, ...key],
    join_conversation: ["conversation", "join", ...conv, ...key],
    leave_conversation: ["conversation", "leave", ...conv, ...key],
    set_processing_status: [
      "processing-status",
      "set",
      ...conv,
      "--thread-ts",
      TS,
      "--status",
      "processing",
      ...key,
    ],
    upload_file: [
      "file",
      "upload",
      ...conv,
      "--file",
      file,
      "--thread-ts",
      TS,
      ...key,
    ],
    get_archive_settings: ["archive", "settings", "get", ...conn],
    update_archive_settings: [
      "archive",
      "settings",
      "update",
      ...conn,
      "--capture-enabled",
      "true",
      "--retention-days",
      "null",
      "--capture-conversation-id",
      "C123",
    ],
    list_archived_messages: [
      "archive",
      "messages",
      ...conv,
      "--thread-ts",
      TS,
      "--before-ts",
      "1234567891.000000",
      "--after-ts",
      "1234567889.000000",
      "--limit",
      "2",
      "--cursor",
      "opaque",
    ],
    search_archived_messages: [
      "archive",
      "search",
      ...conv,
      "--q",
      "retained message",
      "--user-id",
      "U123",
      "--before-ts",
      "1234567891.000000",
      "--after-ts",
      "1234567889.000000",
      "--limit",
      "2",
      "--cursor",
      "opaque",
    ],
    archive_backfill: [
      "archive",
      "backfill",
      ...conv,
      "--thread-ts",
      TS,
      "--restart",
    ],
    list_archive_coverage: [
      "archive",
      "coverage",
      ...conn,
      "--limit",
      "2",
      "--cursor",
      O,
    ],
    purge_archive: ["archive", "purge", ...conn],
  };
}
function run(args) {
  return new Promise((resolve) =>
    execFile(
      process.execPath,
      [cli, ...args],
      { timeout: 15000, env: { ...process.env, NODE_USE_ENV_PROXY: "0" } },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    ),
  );
}
test("CLI exposes every new Slack operation with exact bytes, filters, keys and no automatic repeats", async () => {
  let reply = {};
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString(),
    });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(reply));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const tmp = await mkdtemp(path.join(os.tmpdir(), "slack-actions-"));
  const file = path.join(tmp, "binary.dat");
  await writeFile(file, Buffer.from([0, 255, 1]));
  const globals = [
    "--api-key",
    "synthetic-test-key",
    "--base-url",
    `http://127.0.0.1:${server.address().port}`,
    "--json",
    "slack",
  ];
  try {
    for (const c of data.cases) {
      reply = c.response;
      const result = await run([...globals, ...commands(file)[c.name]]);
      assert.equal(result.error, null, `${c.name}: ${result.stderr}`);
      const request = requests.at(-1),
        url = new URL(request.url, "http://localhost");
      assert.equal(request.method, c.method, c.name);
      assert.equal(url.pathname, "/api/v1" + c.path, c.name);
      assert.deepEqual(Object.fromEntries(url.searchParams), c.query, c.name);
      assert.deepEqual(
        request.body ? JSON.parse(request.body) : null,
        c.body,
        c.name,
      );
      assert.equal(
        request.headers["idempotency-key"] ?? null,
        c.idempotency_key,
        c.name,
      );
      const response = JSON.parse(result.stdout);
      if (c.idempotency_key) assert.equal(response.status, "unknown");
    }
    assert.equal(requests.length, data.cases.length);
    const missingKey = await run([...globals, "pin", "add", ...msg]);
    assert.ok(missingKey.error);
    assert.match(missingKey.stderr, /idempotency-key/);
    await writeFile(file, Buffer.alloc(10 * 1024 * 1024 + 1));
    const tooLarge = await run([...globals, ...commands(file).upload_file]);
    assert.ok(tooLarge.error);
    assert.match(tooLarge.stderr, /10 MiB/);
    assert.equal(requests.length, data.cases.length);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(tmp, { recursive: true, force: true });
  }
});
