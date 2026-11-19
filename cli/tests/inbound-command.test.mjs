import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const source = {
  id: "src_1", name: "payments", url: "https://agent.example.test/inbound/token",
  signature: {scheme: "stripe"}, handler: {type: "agent"},
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};
const event = {
  id: "evt_1", source_id: "src_1", received_at: "2026-01-01T00:00:00Z", status: "delivered", attempts: 1,
  last_error: null, signature_verified: true, content_type: "application/json", size_bytes: 2,
};

async function withApi(action) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const path = req.url;
    requests.push({method: req.method, path, body: chunks.length ? JSON.parse(Buffer.concat(chunks)) : null});
    if (req.method === "DELETE") { res.writeHead(204); return res.end(); }
    const body = path.includes("/events?") || path.endsWith("/events") ? {events: [event], next_cursor: "next"}
      : path.includes("/events/") ? event
      : path.endsWith("/inbound") && req.method === "GET" ? {sources: [source]}
      : source;
    res.writeHead(200, {"content-type": "application/json"});
    res.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const run = (args, {stdin = "", json = true} = {}) => new Promise(resolve => {
    const child = spawn(process.execPath,
      [cli, "--api-key", "test-key", "--base-url", `http://127.0.0.1:${server.address().port}`, ...(json ? ["--json"] : []), "inbound", ...args],
      {env: {...process.env, NODE_USE_ENV_PROXY: "0"}});
    let stdout = "", stderr = "";
    child.stdout.on("data", d => { stdout += d; });
    child.stderr.on("data", d => { stderr += d; });
    child.on("close", code => resolve({code, stdout, stderr}));
    child.stdin.end(stdin);
  });
  try { await action(run, requests); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

const base = "/api/v1/identities/agent/inbound";

test("create reads the signing secret from stdin and sends signature and handler", async () => {
  await withApi(async (run, requests) => {
    const created = await run(["create", "agent", "--name", "payments", "--scheme", "stripe", "--secret-stdin"], {stdin: "whsec_test\n"});
    assert.equal(created.code, 0, created.stderr);
    assert.equal(JSON.parse(created.stdout).url, source.url);
    const hmac = await run(["create", "agent", "--name", "ci", "--scheme", "hmac", "--secret-stdin", "--header", "X-Sig",
      "--algorithm", "sha1", "--encoding", "base64", "--prefix", "sha1=", "--handler", "script", "--command", "./handle.sh"], {stdin: "s"});
    assert.equal(hmac.code, 0, hmac.stderr);
    assert.ifError((await run(["create", "agent", "--name", "open", "--handler", "agent", "--instructions", "Summarize"])).code || null);
    assert.deepEqual(requests.map(r => r.body), [
      {name: "payments", signature: {scheme: "stripe", secret: "whsec_test"}, handler: {type: "agent"}},
      {name: "ci", signature: {scheme: "hmac", secret: "s", header: "X-Sig", algorithm: "sha1", encoding: "base64", prefix: "sha1="},
        handler: {type: "script", command: "./handle.sh"}},
      {name: "open", signature: null, handler: {type: "agent", instructions: "Summarize"}},
    ]);
    assert.ok(requests.every(r => r.method === "POST" && r.path === base));
  });
});

test("source and event commands call the matching endpoints", async () => {
  await withApi(async (run, requests) => {
    for (const args of [
      ["list", "agent"], ["get", "agent", "src_1"], ["update", "agent", "src_1", "--name", "renamed", "--no-signature"],
      ["rotate", "agent", "src_1"], ["delete", "agent", "src_1"],
      ["events", "list", "agent", "src_1", "--limit", "5", "--cursor", "c1"], ["events", "get", "agent", "src_1", "evt_1"],
      ["events", "replay", "agent", "src_1", "evt_1"],
    ]) {
      const result = await run(args);
      assert.equal(result.code, 0, `${args.join(" ")}: ${result.stderr}`);
    }
    assert.deepEqual(requests.map(r => [r.method, r.path]), [
      ["GET", base], ["GET", `${base}/src_1`], ["PATCH", `${base}/src_1`], ["POST", `${base}/src_1/rotate`],
      ["DELETE", `${base}/src_1`], ["GET", `${base}/src_1/events?limit=5&cursor=c1`], ["GET", `${base}/src_1/events/evt_1`],
      ["POST", `${base}/src_1/events/evt_1/replay`],
    ]);
    assert.deepEqual(requests[2].body, {name: "renamed", signature: null});
    const human = await run(["list", "agent"], {json: false});
    assert.match(human.stdout, /payments\s+https:\/\/agent\.example\.test\/inbound\/token\s+stripe\s+agent/);
  });
});

test("invalid option combinations fail before a request", async () => {
  await withApi(async (run, requests) => {
    for (const args of [
      ["create", "agent", "--name", "x", "--scheme", "stripe"],
      ["create", "agent", "--name", "x", "--secret-stdin"],
      ["create", "agent", "--name", "x", "--scheme", "github", "--secret-stdin", "--header", "X"],
      ["create", "agent", "--name", "x", "--handler", "script"],
      ["create", "agent", "--name", "x", "--handler", "agent", "--command", "run"],
      ["create", "agent", "--name", "x", "--scheme", "unknown", "--secret-stdin"],
      ["update", "agent", "src_1"],
      ["update", "agent", "src_1", "--no-signature", "--scheme", "slack", "--secret-stdin"],
      ["events", "list", "agent", "src_1", "--limit", "0"],
    ]) assert.notEqual((await run(args, {stdin: "s"})).code, 0, args.join(" "));
    assert.equal(requests.length, 0);
  });
});
