import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const config = {mode: "inkbox", identity_id: "identity", state: "ready", generation: 2, applied_generation: 2};

async function withApi(action) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({method: req.method, path: req.url, body: chunks.length ? JSON.parse(Buffer.concat(chunks)) : null});
    res.writeHead(200, {"content-type": "application/json"});
    res.end(JSON.stringify(config));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const run = args => new Promise(resolve => execFile(process.execPath,
    [cli, "--api-key", "test-key", "--base-url", `http://127.0.0.1:${server.address().port}`, "--json", "identity", "hosting", ...args],
    {timeout: 15000, env: {...process.env, NODE_USE_ENV_PROXY: "0"}},
    (error, stdout, stderr) => resolve({error, stdout, stderr})));
  try { await action(run, requests); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test("hosting configuration preserves empty triggers and explicit model credits", async () => {
  await withApi(async (run, requests) => {
    const result = await run(["configure", "example", "--expected-generation", "1", "--events", "", "--credits"]);
    assert.ifError(result.error);
    assert.deepEqual(requests, [{method: "PUT", path: "/api/v1/identities/example/hosting", body: {
      expected_generation: 1, trigger_events: [], credential_binding_id: null,
    }}]);
    assert.equal(JSON.parse(result.stdout).generation, 2);
  });
});

test("chat rename patches the selected conversation", async () => {
  await withApi(async (run, requests) => {
    const result = await run(["chat", "rename", "example", "conversation", "--title", "Inbox review", "--idempotency-key", "rename-once"]);
    assert.ifError(result.error);
    assert.deepEqual(requests, [{method: "PATCH", path: "/api/v1/identities/example/hosting/chat/conversations/conversation", body: {title: "Inbox review"}}]);
  });
});

test("removing hosting sends the generation and preserves omitted configuration", async () => {
  await withApi(async (run, requests) => {
    const result = await run(["remove", "example", "--expected-generation", "2"]);
    assert.ifError(result.error);
    assert.deepEqual(requests[0].body, {expected_generation: 2, enabled: false});
  });
});

test("conflicting hosting options and invalid generations fail before a request", async () => {
  await withApi(async (run, requests) => {
    for (const args of [
      ["--expected-generation", "1", "--events", "mail.received", "--default-events"],
      ["--expected-generation", "1", "--model-key", "saved-key", "--credits"],
      ["--expected-generation", "-1"],
      ["--expected-generation", "9007199254740992"],
      ["--expected-generation", "1", "--idle-seconds", "59"],
    ]) {
      const result = await run(["configure", "example", ...args]);
      assert.ok(result.error);
    }
    assert.equal(requests.length, 0);
  });
});
