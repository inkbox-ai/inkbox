import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const data = JSON.parse(await readFile(new URL("../../tests/fixtures/slack_task_streams.json", import.meta.url), "utf8"));
function run(args) {
  return new Promise(resolve => execFile(process.execPath, [cli, ...args],
    { timeout: 15000, env: { ...process.env, NODE_USE_ENV_PROXY: "0" } },
    (error, stdout, stderr) => resolve({ error, stdout, stderr })));
}
test("task streams use typed SDK methods, exact wire bodies and key-only recovery", async () => {
  let reply;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(parts).toString() });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(reply));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const globals = ["--api-key", "synthetic-test-key", "--base-url", `http://127.0.0.1:${server.address().port}`, "--json", "slack"];
  try {
    for (const c of data.cases) {
      reply = c.response;
      const args = ["--connection-id", data.connection_id, "--idempotency-key", c.idempotency_key];
      let command;
      if (c.name === "get_by_key") command = ["operation", "get-by-key", ...args];
      else {
        args.push("--conversation-id", data.conversation_id);
        if (c.name.startsWith("start")) {
          command = ["stream", "start", ...args, "--thread-ts", data.thread_ts,
            "--recipient-user-id", "U123", "--recipient-team-id", "T123", "--chunks", JSON.stringify(c.body.chunks)];
          if (c.name === "start_plan") command.push("--task-display-mode", "plan");
        } else {
          command = ["stream", c.name === "append" ? "append" : "stop", ...args, "--stream-id", data.stream_id];
          if (c.name !== "stop_empty") command.push("--chunks", JSON.stringify(c.body.chunks));
        }
      }
      const before = requests.length;
      const result = await run([...globals, ...command]);
      assert.equal(result.error, null, result.stderr);
      assert.equal(requests.length, before + 1);
      const req = requests.at(-1);
      assert.equal(req.method, c.method);
      assert.equal(req.url, "/api/v1" + c.path);
      assert.equal(req.headers["idempotency-key"], c.idempotency_key);
      assert.deepEqual(req.body ? JSON.parse(req.body) : null, c.body);
      assert.equal(JSON.parse(result.stdout).threadTs, data.thread_ts);
      assert.equal(JSON.parse(result.stdout).status, c.response.status);
    }
    const before = requests.length;
    for (const chunks of ["not JSON", "{}", '[{"type":"markdown_text"}]']) {
      const result = await run([...globals, "stream", "append", "--connection-id", data.connection_id,
        "--conversation-id", data.conversation_id, "--stream-id", data.stream_id,
        "--idempotency-key", "valid-key", "--chunks", chunks]);
      assert.ok(result.error);
      assert.match(result.stderr, /JSON array/);
    }
    assert.equal(requests.length, before);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
