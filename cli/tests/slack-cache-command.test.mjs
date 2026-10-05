import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const data = JSON.parse(await readFile(new URL("../../tests/fixtures/slack_cached_archive.json", import.meta.url), "utf8"));
const run = args => new Promise(resolve => execFile(process.execPath, [cli, ...args],
  { timeout: 15000, env: { ...process.env, NODE_USE_ENV_PROXY: "0" } },
  (error, stdout, stderr) => resolve({ error, stdout, stderr })));
test("cached archive, emoji and byte commands preserve scopes, state and output files", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    assert.equal(req.headers["x-api-key"], "synthetic-test-key");
    if (req.url.includes("/cached-media/") || req.url.includes("/preview")) {
      res.end(Buffer.from([0, 255, 1])); return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url.includes("/emoji?") ? data.emoji_page : data.page));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const dir = await mkdtemp(path.join(os.tmpdir(), "slack-cache-"));
  const globals = ["--api-key", "synthetic-test-key", "--base-url", `http://127.0.0.1:${server.address().port}`, "--json", "slack"];
  const conn = ["--connection-id", data.connection_id];
  try {
    let result = await run([...globals, "archive", "messages", ...conn, "--roots-only", "--include", "conversation,sender,reactions,files"]);
    assert.equal(result.error, null, result.stderr);
    const page = JSON.parse(result.stdout);
    assert.equal(page.messages[0].reactions[0].count, null);
    assert.equal(page.messages[0].reactions[1].count, 0);
    assert.deepEqual(Object.fromEntries(new URL(requests[0], "http://localhost").searchParams), {
      limit: "50", roots_only: "true", include: "conversation,sender,reactions,files",
    });
    result = await run([...globals, "emoji", "list", ...conn, "--q", "party +", "--limit", "2", "--cursor", "previous"]);
    assert.equal(result.error, null, result.stderr);
    assert.equal(JSON.parse(result.stdout).nextCursor, "party");
    assert.equal(requests.length, 2);
    const invalid = await run([...globals, "archive", "messages", ...conn, "--include", "unsupported"]);
    assert.notEqual(invalid.error, null);
    assert.equal(requests.length, 2);
    for (const [name, command] of [["avatar", ["cached-media-download", "--kind", "user", "--resource-id", "U123"]],
      ["preview", ["file", "preview", "--file-id", "F123"]]]) {
      const destination = path.join(dir, name);
      result = await run([...globals, ...command, ...conn, "--output", destination]);
      assert.equal(result.error, null, result.stderr);
      assert.deepEqual(await readFile(destination), Buffer.from([0, 255, 1]));
      const repeat = await run([...globals, ...command, ...conn, "--output", destination]);
      assert.notEqual(repeat.error, null);
      assert.deepEqual(await readFile(destination), Buffer.from([0, 255, 1]));
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
