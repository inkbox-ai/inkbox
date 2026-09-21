import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("../../tests/fixtures/companion-v1.json", import.meta.url), "utf8"));
const activation = fixture.pages[0].activation_id;
const notice = fixture.pages[0].notices[0];
async function run(url, args, apiKey = "test-key") {
  return new Promise((resolve) => execFile(process.execPath, [cli, "--api-key", apiKey, "--base-url", url, "--json", ...args], {
    timeout: 15000, env: { ...process.env, NODE_USE_ENV_PROXY: "0", INKBOX_VAULT_KEY: "" },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
}
async function serve(handler, action) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await action(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
function respond(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

for (const apiKey of ["test-agent-key", "test-admin-key"]) {
  for (const name of ["config", "config_without_resources"]) {
    for (const enabled of [false, true]) {
      test(`Companion get returns only config fields: ${apiKey}, ${name}, enabled=${enabled}`, async () => {
        const requests = [];
        const config = { ...fixture[name], enabled };
        await serve((req, res) => {
          requests.push({ url: req.url, method: req.method, key: req.headers["x-api-key"] });
          respond(res, config);
        }, async (url) => {
          const got = await run(url, ["identity", "companion", "get", "example-agent"], apiKey);
          assert.ifError(got.error);
          assert.deepEqual(JSON.parse(got.stdout), {
            enabled, configRevision: config.config_revision, readiness: config.readiness,
          });
          assert.deepEqual(requests, [{ url: "/api/v1/identities/example-agent/companion", method: "GET", key: apiKey }]);
        });
      });
    }
  }
}

test("Companion configuration writes only enabled before resources exist", async () => {
  const requests = [];
  await serve(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, method: req.method, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null });
    respond(res, { ...fixture.config_without_resources, enabled: requests.at(-1).body.enabled });
  }, async (url) => {
    const prefix = ["identity", "companion"];
    for (const enabled of [true, false]) {
      const updated = await run(url, [...prefix, "update", "example-agent", "--enabled", String(enabled)]);
      assert.ifError(updated.error);
      assert.deepEqual(requests.at(-1), { url: "/api/v1/identities/example-agent/companion", method: "PATCH", body: { enabled } });
      const result = JSON.parse(updated.stdout);
      assert.equal(result.enabled, enabled);
      assert.deepEqual(result.readiness, fixture.config_without_resources.readiness);
    }
    assert.equal(requests.length, 2);
  });
});

test("Companion update rejects obsolete and invalid flags locally", async () => {
  const requests = [];
  await serve((req, res) => {
    requests.push(req.url);
    respond(res, fixture.config);
  }, async (url) => {
    const count = requests.length;
    for (const args of [["--enabled", "yes"], ["--enabled", "null"],
      ["--enabled", "true", "--sponsor", "{}"], ["--sponsor", "null"],
      ["--enabled", "true", "--enabld", "true"], []]) {
      const bad = await run(url, ["identity", "companion", "update", "example-agent", ...args]);
      assert.equal(bad.error?.code, 1);
      assert.equal(bad.stdout, "");
      if (args.includes("--sponsor") && args.includes("--enabled")) assert.match(bad.stderr, /unknown option '--sponsor'/);
    }
    assert.equal(requests.length, count);
  });
});

test("state/history JSON retain pagination and notices preserve output semantics", async () => {
  const requests = [];
  await serve((req, res) => {
    requests.push(req.url);
    respond(res, req.url.includes("conversations") ? { items: [], total: 8 } : fixture.pages[0]);
  }, async (url) => {
    const state = await run(url, ["identity", "companion", "state", "example-agent", "--channel", "phone", "--limit", "200", "--offset", "4"]);
    assert.ifError(state.error);
    assert.deepEqual(JSON.parse(state.stdout), { items: [], total: 8 });
    assert.match(requests[0], /limit=200/);
    assert.match(requests[0], /offset=4/);
    const args = ["identity", "companion", "history", "example-agent", activation, "--cursor", "opaque-value", "--limit", "1"];
    const history = await run(url, args);
    assert.ifError(history.error);
    assert.equal(JSON.parse(history.stdout).nextCursor, "opaque-page-2");
    assert.equal(JSON.parse(history.stdout).historyComplete, false);
    assert.deepEqual(JSON.parse(history.stderr), { notices: [notice] });
    const envelope = await run(url, ["--with-response-metadata", ...args]);
    assert.ifError(envelope.error);
    assert.equal(envelope.stderr, "");
    assert.deepEqual(JSON.parse(envelope.stdout).notices, [notice]);
  });
});

test("complete initialization exhausts pages, revalidates and errors never emit partial stdout", async () => {
  let denied = false;
  let calls = 0;
  await serve((req, res) => {
    calls++;
    respond(res, denied ? { detail: "Activation unavailable" } : fixture.pages[req.url.includes("cursor=") ? 1 : 0], denied ? 403 : 200);
  }, async (url) => {
    const args = ["identity", "companion", "initialization", "example-agent", activation];
    const complete = await run(url, args);
    assert.ifError(complete.error);
    assert.equal(JSON.parse(complete.stdout).entries.length, 3);
    assert.equal(calls, 3);
    const bounded = await run(url, [...args, "--max-bytes", "20"]);
    assert.equal(bounded.error?.code, 1);
    assert.equal(bounded.stdout, "");
    denied = true;
    const failed = await run(url, args);
    assert.equal(failed.error?.code, 1);
    assert.equal(failed.stdout, "");
    assert.equal(JSON.parse(failed.stderr).error.statusCode, 403);
  });
});

test("history and initialization accept either UUID case and reject different activation IDs", async () => {
  const requests = [];
  await serve((req, res) => {
    requests.push(req.url);
    respond(res, fixture.pages[req.url.includes("cursor=") ? 1 : 0]);
  }, async (url) => {
    for (const command of ["history", "initialization"]) {
      for (const id of [activation, activation.toUpperCase()]) {
        const result = await run(url, ["identity", "companion", command, "example-agent", id]);
        assert.ifError(result.error);
        const data = JSON.parse(result.stdout);
        assert.equal(data.activationId, activation);
        assert.equal(data.replyContext.conversationId, fixture.pages[0].conversation_id);
        assert.equal(command === "history" ? data.items.length : data.entries.length, command === "history" ? 2 : 3);
      }
      for (const id of [fixture.pages[0].scope_id, fixture.pages[0].scope_id.toUpperCase()]) {
        const result = await run(url, ["identity", "companion", command, "example-agent", id]);
        assert.equal(result.error?.code, 1);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /Invalid Companion activation page or reply scope/);
      }
    }
    assert.equal(requests.length, 12);
  });
});
