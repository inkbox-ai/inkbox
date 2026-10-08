import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const fixture = JSON.parse(readFileSync(new URL("../../tests/fixtures/imessage_sender_addresses.json", import.meta.url), "utf8"));
const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));

async function setup(t) {
  const writes = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    response.setHeader("content-type", "application/json");
    if (request.method !== "GET") {
      writes.push({ method: request.method, path });
      response.writeHead(422).end(JSON.stringify({ detail: fixture.error }));
      return;
    }
    const routes = {
      "/api/v1/identities/support-bot": {
        id: fixture.identity_id, organization_id: "org_example", agent_handle: "support-bot",
        imessage_enabled: true, created_at: fixture.message.created_at, updated_at: fixture.message.updated_at,
      },
      "/api/v1/imessage/messages": [fixture.message],
      [`/api/v1/imessage/messages/${fixture.message.id}`]: fixture.message,
      "/api/v1/imessage/conversations": [fixture.conversation],
      "/api/v1/imessage/assignments": [fixture.assignment],
    };
    if (!(path in routes)) { response.writeHead(404).end(); return; }
    response.end(JSON.stringify(routes[path]));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const run = (json, ...args) => exec(process.execPath, [cli,
    "--base-url", `http://127.0.0.1:${server.address().port}`, "--api-key", "test-only",
    ...(json ? ["--json"] : []), "imessage", ...args, "--identity", "support-bot",
  ], { env: { ...process.env, NODE_USE_ENV_PROXY: "0" }, timeout: 10000 });
  return { run, writes };
}

test("iMessage reads preserve sender addresses in JSON and tables without sending receipts", async t => {
  const { run, writes } = await setup(t);
  for (const args of [["list"], ["conversation", fixture.conversation.id], ["conversations"], ["assignments"]]) {
    const rows = JSON.parse((await run(true, ...args)).stdout);
    assert.equal(rows[0].remoteNumber, fixture.sender);
    const table = (await run(false, ...args)).stdout;
    assert.ok(table.includes(fixture.sender), table);
  }
  const message = JSON.parse((await run(true, "get", fixture.message.id)).stdout);
  assert.equal(message.remoteNumber, fixture.sender);
  assert.deepEqual(writes, []);
});

test("receive-only sends and actions expose the original 422 code without retrying", async t => {
  const { run, writes } = await setup(t);
  const commands = [
    ["send", "--conversation-id", fixture.conversation.id, "--text", "Hello"],
    ["react", fixture.message.id, "--reaction", "like"],
    ["unreact", "50000000-0000-4000-8000-000000000005"],
    ["mark-conversation-read", fixture.conversation.id],
    ["typing", fixture.conversation.id],
  ];
  for (const [index, args] of commands.entries()) {
    await assert.rejects(run(true, ...args), error => {
      const diagnostic = JSON.parse(error.stderr).error;
      assert.equal(diagnostic.statusCode, 422);
      assert.deepEqual(diagnostic.detail, fixture.error);
      return true;
    });
    assert.equal(writes.length, index + 1);
  }
});
