import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const f = JSON.parse(await readFile(new URL("../../tests/fixtures/slack_lifecycle.json", import.meta.url), "utf8"));

test("Slack app status and retained history commands preserve identity, filters, and paging", async () => {
  const requests = [];
  let response = {};
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: new URL(req.url, "http://localhost") });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const globals = ["--api-key", "synthetic-test-key", "--base-url", `http://127.0.0.1:${server.address().port}`, "--json"];
  const run = args => new Promise((resolve, reject) => execFile(process.execPath, [cli, ...globals, ...args],
    { timeout: 15000, env: { ...process.env, NODE_USE_ENV_PROXY: "0" } },
    (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(JSON.parse(stdout))));
  const identity = ["--identity-id", f.deletion.identity_id];
  try {
    response = f.application_state;
    const state = await run(["slack", "app", "status", ...identity]);
    assert.equal(state.application.status, "deleting");
    assert.equal(state.deletion.status, "pending");
    assert.equal(requests.at(-1).url.pathname, "/api/v1/slack/applications");
    response = f.workspaces;
    const workspaces = await run(["slack", "history", "workspaces", ...identity]);
    assert.equal(workspaces[0].liveConnectionId, null);
    response = f.history;
    const page = await run(["slack", "history", "messages", ...identity, "--workspace-id", "TEXAMPLE",
      "--q", "tea", "--conversation-id", "CEXAMPLE", "--thread-ts", "1700000000.000001", "--cursor", "previous", "--limit", "2"]);
    assert.equal(page.nextCursor, "next-page");
    assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), {
      identity_id: f.deletion.identity_id, workspace_id: "TEXAMPLE", q: "tea", conversation_id: "CEXAMPLE",
      thread_ts: "1700000000.000001", cursor: "previous", limit: "2",
    });
    response = f.sources;
    const sources = await run(["slack", "history", "sources", ...identity, "--message-id", f.deletion.id]);
    assert.equal(sources[0].applicationId, f.deletion.application_id);
    assert.ok(requests.every(request => request.method === "GET"));
    const count = requests.length;
    await assert.rejects(run(["slack", "history", "messages", ...identity, "--thread-ts", "1700000000.000001"]),
      /requires --conversation-id/);
    assert.equal(requests.length, count);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
