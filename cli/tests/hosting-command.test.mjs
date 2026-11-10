import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const config = {mode: "inkbox", identity_id: "identity", state: "ready", generation: 2, applied_generation: 2, default_model: "gpt-6-luna"};

async function withApi(action, response = () => config) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({method: req.method, path: req.url, body: chunks.length ? JSON.parse(Buffer.concat(chunks)) : null});
    res.writeHead(200, {"content-type": "application/json"});
    res.end(JSON.stringify(response(req)));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const run = (args, json = true) => new Promise(resolve => execFile(process.execPath,
    [cli, "--api-key", "test-key", "--base-url", `http://127.0.0.1:${server.address().port}`, ...(json ? ["--json"] : []), "identity", "hosting", ...args],
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
      ["--expected-generation", "1", "--idle-seconds", "600"],
      ["--expected-generation", "1", "--idle-seconds", "1800"],
      ["--expected-generation", "1", "--size", "small"],
      ["--expected-generation", "1", "--size", "large"],
      ["--expected-generation", "1", "--idle-seconds", "301"],
      ["--expected-generation", "1", "--idle-seconds", "86400"],
      ["--expected-generation", "1", "--always-on"],
      ["--expected-generation", "1", "--default-model", "gpt-5.4"],
    ]) {
      const result = await run(["configure", "example", ...args]);
      assert.ok(result.error);
    }
    assert.equal(requests.length, 0);
  });
});

test("hosting accepts only supported idle choices and preserves the default model", async () => {
  await withApi(async (run, requests) => {
    for (const seconds of [60, 300]) {
      const result = await run(["configure", "example", "--expected-generation", "1", "--idle-seconds", String(seconds), "--idle-stop", "--default-model", "gpt-6-luna"]);
      assert.ifError(result.error);
      assert.deepEqual(requests.at(-1).body, {expected_generation:1,idle_timeout_seconds:seconds,idle_stop_enabled:true,default_model:"gpt-6-luna"});
      assert.equal(JSON.parse(result.stdout).defaultModel, "gpt-6-luna");
    }
    const result = await run(["get", "example"]);
    assert.ifError(result.error);
    assert.equal(JSON.parse(result.stdout).defaultModel, "gpt-6-luna");
  });
});

test("chat permissions persists the selected mode and rejects unknown modes", async () => {
  await withApi(async (run, requests) => {
    const result = await run(["chat", "permissions", "example", "conversation", "--mode", "yolo", "--idempotency-key", "mode-once"]);
    assert.ifError(result.error);
    assert.deepEqual(requests, [{method: "PATCH", path: "/api/v1/identities/example/hosting/chat/conversations/conversation", body: {permission_mode: "yolo"}}]);
    const invalid = await run(["chat", "permissions", "example", "conversation", "--mode", "always", "--idempotency-key", "mode-twice"]);
    assert.ok(invalid.error);
    assert.equal(requests.length, 1);
  });
});

for (const [args, endpoint] of [[['chat', 'list'], 'chat/conversations'], [['workspace', 'terminals'], 'workspace/terminals'], [['workspace', 'schedules'], 'workspace/schedules']]) {
  test(`${args.join(' ')} forwards cursor and page size`, async () => {
    await withApi(async (run, requests) => {
      assert.ifError((await run([...args, 'example', '--after', 'next-page', '--limit', '20'])).error);
      const url = new URL(requests[0].path, 'https://example.test');
      assert.equal(url.pathname, `/api/v1/identities/example/hosting/${endpoint}`);
      assert.equal(url.searchParams.get('after'), 'next-page');
      assert.equal(url.searchParams.get('limit'), '20');
      for (const limit of ['0', '-1', '101', '1.5', 'abc', '9007199254740992']) {
        assert.ok((await run([...args, 'example', '--limit', limit])).error);
      }
      assert.equal(requests.length, 1);
    });
  });
}


test("chat list forwards origin and rejects unknown origins", async () => {
  await withApi(async (run, requests) => {
    assert.ifError((await run(['chat', 'list', 'example', '--origin', 'chat'])).error);
    assert.equal(new URL(requests[0].path, 'https://example.test').searchParams.get('origin'), 'chat');
    assert.ok((await run(['chat', 'list', 'example', '--origin', 'invalid'])).error);
    assert.equal(requests.length, 1);
  });
});


test("schedule list exposes its cursor in both output modes and retrieves paused jobs beyond page one", async () => {
  const cursor = "page2+/=";
  await withApi(async (run, requests) => {
    const args = ["workspace", "schedules", "example"];
    const help = await run([...args, "--help"]);
    assert.ifError(help.error);
    assert.match(help.stdout, /--after <cursor>/);
    assert.match(help.stdout, /next_cursor/);
    assert.match(help.stdout, /--limit <count>/);
    assert.equal(requests.length, 0);
    const first = await run(args);
    assert.ifError(first.error);
    const page = JSON.parse(first.stdout);
    assert.equal(page.items.length, 50);
    assert.equal(page.next_cursor, cursor);
    const initialUrl = new URL(requests[0].path, "https://example.test");
    assert.equal(initialUrl.searchParams.get("limit"), "50");
    assert.equal(initialUrl.searchParams.has("after"), false);
    const human = await run(args, false);
    assert.ifError(human.error);
    assert.match(human.stdout, /next_cursor\s+page2\+\/=/);
    const next = await run([...args, "--after", page.next_cursor, "--limit", "100"]);
    assert.ifError(next.error);
    assert.deepEqual(JSON.parse(next.stdout), {items: [{id: "job51", enabled: false}], next_cursor: null});
    const nextUrl = new URL(requests.at(-1).path, "https://example.test");
    assert.equal(nextUrl.searchParams.get("after"), cursor);
    assert.equal(nextUrl.searchParams.get("limit"), "100");
    assert.ifError((await run([...args, "--limit", "1"])).error);
    assert.equal(new URL(requests.at(-1).path, "https://example.test").searchParams.get("limit"), "1");
  }, req => new URL(req.url, "https://example.test").searchParams.get("after") === cursor
    ? {items: [{id: "job51", enabled: false}], next_cursor: null}
    : {items: Array.from({length: 50}, (_, i) => ({id: `job${i + 1}`, enabled: false})), next_cursor: cursor});
});


test("chat upload accepts the 5 MB contract boundary and rejects one byte over before HTTP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inkbox-upload-"));
  const path = join(directory, "attachment.bin");
  try {
    await withApi(async (run, requests) => {
      for (const size of [300_000, 5_000_000]) {
        const data = Buffer.alloc(size, 0xa5);
        await writeFile(path, data);
        const result = await run(["chat", "upload", "example", path, "--name", "attachment.bin", "--idempotency-key", `upload-${size}`]);
        assert.ifError(result.error);
        const request = requests.at(-1);
        assert.equal(request.method, "POST");
        assert.equal(request.path, "/api/v1/identities/example/hosting/chat/files");
        assert.deepEqual(Buffer.from(request.body.data_base64, "base64"), data);
      }
      await writeFile(path, Buffer.alloc(5_000_001));
      const result = await run(["chat", "upload", "example", path, "--name", "attachment.bin", "--idempotency-key", "too-large"]);
      assert.ok(result.error);
      assert.match(result.stderr, /5 MB \(5,000,000 bytes\)/);
      assert.equal(requests.length, 2);
    });
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("published chat file schema advertises the decoded 5 MB limit", async () => {
  const schema = JSON.parse(await readFile(new URL("../../contracts/event-v1.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(schema.$defs.ArtifactData.properties.size_bytes, {
    maximum: 5_000_000, minimum: 0, title: "Size Bytes", type: "integer",
  });
});
