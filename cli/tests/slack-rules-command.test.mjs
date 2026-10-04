import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const id = "11111111-1111-4111-8111-111111111111";
const rule = { id, agent_identity_id: id, action: "allow", match_type: "workspace", match_target: "TEXAMPLE",
  direction: "both", status: "active", created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" };
test("Slack rule/import commands use canonical SDK wire and preserve continuation", async () => {
  let reply = rule;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString() });
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(reply));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const globals = ["--api-key", "synthetic", "--base-url", `http://127.0.0.1:${server.address().port}`, "--json"];
  const run = (args) => new Promise((resolve, reject) => execFile(process.execPath, [cli, ...globals, "slack", ...args],
    { env: { ...process.env, NODE_USE_ENV_PROXY: "0" }, timeout: 15000 }, (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(JSON.parse(stdout))));
  try {
    await run(["contact-rule", "create", "project-agent", "--action", "allow", "--match-type", "workspace", "--match-target", "TEXAMPLE"]);
    assert.equal(requests.at(-1).url, "/api/v1/identities/project-agent/slack-contact-rules");
    assert.deepEqual(JSON.parse(requests.at(-1).body), { action: "allow", match_type: "workspace", match_target: "TEXAMPLE" });
    await run(["contact-rule", "update", "project-agent", id, "--action", "block", "--apply-to", "outbound"]);
    assert.equal(requests.at(-1).method, "PATCH");
    assert.deepEqual(JSON.parse(requests.at(-1).body), { action: "block", apply_to: "outbound" });
    reply = { imported_count: 0, skipped_count: 1, contact_ids: [], next_cursor: "next" };
    assert.equal((await run(["contacts-import", "--connection-id", id, "--conversation-id", "CEXAMPLE", "--cursor", "previous"])).nextCursor, "next");
    assert.deepEqual(JSON.parse(requests.at(-1).body), { limit: 100, cursor: "previous", conversation_id: "CEXAMPLE" });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});


test("identity update rejects a successful older API response that ignored Slack mode", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id, agent_handle: "project-agent", organization_id: "example-org", created_at: rule.created_at, updated_at: rule.updated_at }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await new Promise((resolve) => execFile(process.execPath, [cli,
      "--api-key", "synthetic", "--base-url", `http://127.0.0.1:${server.address().port}`,
      "identity", "update", "project-agent", "--slack-filter-mode", "whitelist"],
      { env: { ...process.env, NODE_USE_ENV_PROXY: "0" }, timeout: 15000 },
      (error, stdout, stderr) => resolve({ error, stdout, stderr })));
    assert.ok(result.error, "unsupported updates must exit unsuccessfully");
    assert.match(result.stderr, /not confirmed/);
    assert.doesNotMatch(result.stdout, /updated successfully/i);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
