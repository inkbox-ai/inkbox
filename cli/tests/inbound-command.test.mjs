import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const source = {
  id: "src_1", name: "payments", url: "https://agent.example.test/inbound/token",
  signature: {secret_encoding: "text", header: "Example-Signature", format: "list", format_value: "v1", algorithm: "sha256",
    encoding: "hex", signed_content: "{timestamp}.{body}", timestamp_from: "list", timestamp_value: "t", max_age_seconds: 300},
  handler: {type: "agent"},
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
      : path.endsWith("/signature-check") ? {verified: false, reason: "Signature does not match"}
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
    const created = await run(["create", "agent", "--name", "payments", "--secret-stdin", "--header", "Example-Signature",
      "--format", "list", "--format-value", "v1", "--signed-content", "{timestamp}.{body}", "--timestamp-from", "list",
      "--timestamp-value", "t", "--max-age", "300"], {stdin: "whsec_test\n"});
    assert.equal(created.code, 0, created.stderr);
    assert.equal(JSON.parse(created.stdout).url, source.url);
    const hmac = await run(["create", "agent", "--name", "ci", "--secret-stdin", "--header", "X-Sig", "--secret-encoding", "base64",
      "--algorithm", "sha512", "--encoding", "base64", "--format", "prefix", "--format-value", "sha512=", "--handler", "script",
      "--command", "./handle.sh"], {stdin: "c2VjcmV0"});
    assert.equal(hmac.code, 0, hmac.stderr);
    assert.ifError((await run(["create", "agent", "--name", "open", "--handler", "agent", "--instructions", "Summarize"])).code || null);
    assert.deepEqual(requests.map(r => r.body), [
      {name: "payments", signature: {secret: "whsec_test", header: "Example-Signature", format: "list", format_value: "v1",
        signed_content: "{timestamp}.{body}", timestamp_from: "list", timestamp_value: "t", max_age_seconds: 300}, handler: {type: "agent"}},
      {name: "ci", signature: {secret: "c2VjcmV0", header: "X-Sig", secret_encoding: "base64", format: "prefix", format_value: "sha512=",
        algorithm: "sha512", encoding: "base64"}, handler: {type: "script", command: "./handle.sh"}},
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
    assert.match(human.stdout, /payments\s+https:\/\/agent\.example\.test\/inbound\/token\s+Example-Signature\s+agent/);
  });
});

test("invalid option combinations fail before a request", async () => {
  await withApi(async (run, requests) => {
    for (const args of [
      ["create", "agent", "--name", "x", "--header", "X"],
      ["create", "agent", "--name", "x", "--secret-stdin"],
      ["create", "agent", "--name", "x", "--format", "list", "--secret-stdin"],
      ["create", "agent", "--name", "x", "--secret-stdin", "--header", "X", "--max-age", "5m"],
      ["create", "agent", "--name", "x", "--secret-stdin", "--header", "X", "--format", "json"],
      ["create", "agent", "--name", "x", "--scheme", "stripe", "--secret-stdin", "--header", "X"],
      ["update", "agent", "src_1", "--signed-content", "{body}"],
      ["create", "agent", "--name", "x", "--handler", "script"],
      ["create", "agent", "--name", "x", "--handler", "agent", "--command", "run"],
      ["check-signature", "agent", "--body-file", "/dev/null"],
      ["check-signature", "agent", "--source", "src_1", "--secret-stdin", "--header", "X", "--body-file", "/dev/null"],
      ["check-signature", "agent", "--source", "src_1", "--sample-header", "nocolon", "--body-file", "/dev/null"],
      ["update", "agent", "src_1"],
      ["update", "agent", "src_1", "--no-signature", "--header", "X", "--secret-stdin"],
      ["events", "list", "agent", "src_1", "--limit", "0"],
    ]) assert.notEqual((await run(args, {stdin: "s"})).code, 0, args.join(" "));
    assert.equal(requests.length, 0);
  });
});

test("check-signature sends a sample with settings or a saved source", async () => {
  await withApi(async (run, requests) => {
    const dir = mkdtempSync(join(tmpdir(), "inbound-check-"));
    writeFileSync(join(dir, "body.json"), '{"ok":true}');
    writeFileSync(join(dir, "body.bin"), Buffer.from([0xff]));
    const human = await run(["check-signature", "agent", "--secret-stdin", "--header", "X-Sig", "--sample-header", "X-Sig: 00",
      "--sample-header", "X-Id:42", "--body-file", join(dir, "body.json")], {stdin: "s", json: false});
    assert.equal(human.code, 1);
    assert.match(human.stdout, /Signature is not valid: Signature does not match/);
    const json = await run(["check-signature", "agent", "--source", "src_1", "--body-file", join(dir, "body.bin")]);
    assert.deepEqual(JSON.parse(json.stdout), {verified: false, reason: "Signature does not match"});
    assert.deepEqual(requests.map(r => [r.method, r.path, r.body]), [
      ["POST", `${base}/signature-check`, {headers: {"X-Sig": "00", "X-Id": "42"}, body: '{"ok":true}', signature: {secret: "s", header: "X-Sig"}}],
      ["POST", `${base}/signature-check`, {headers: {}, body: "/w==", body_encoding: "base64", source_id: "src_1"}],
    ]);
  });
});
