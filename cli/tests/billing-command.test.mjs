import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const exec = promisify(execFile);

test("multiple countries require confirmation and share one purchase request", async (t) => {
  const calls = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    calls.push({ path: request.url, body: JSON.parse(raw) });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ quote: "accepted", countries: [], agreements: [], included_country_codes: [] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const env = { ...process.env, INKBOX_API_KEY: "synthetic-test-key", INKBOX_BASE_URL: `http://127.0.0.1:${server.address().port}`, NODE_USE_ENV_PROXY: "0" };
  const run = (...args) => exec(process.execPath, [cli, "billing", "countries", ...args], { env });
  await run("quote-many", "FR", "JP");
  assert.deepEqual(calls[0], { path: "/api/v1/billing/calling-countries/quote", body: { country_codes: ["FR", "JP"] } });
  const key = "a3f22fcb-d805-4811-830c-2c61c3da5316";
  const args = ["purchase-many", "FR", "JP", "--quote", "accepted", "--request-key", key];
  await assert.rejects(run(...args), /--confirm/);
  assert.equal(calls.length, 1);
  await run(...args, "--confirm");
  await run(...args, "--confirm");
  assert.deepEqual(calls[1], { path: "/api/v1/billing/calling-countries", body: { country_codes: ["FR", "JP"], quote: "accepted", request_key: key } });
  assert.deepEqual(calls[1], calls[2]);
});

test("line bundle purchase requires explicit confirmation and preserves retry identity", async (t) => {
  const calls = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    calls.push({ path: request.url, body: JSON.parse(raw) });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ offers: [], agreements: [], voice_seconds_remaining: 900, messages_remaining: 150 }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const env = { ...process.env, INKBOX_API_KEY: "synthetic-test-key", INKBOX_BASE_URL: `http://127.0.0.1:${server.address().port}`, NODE_USE_ENV_PROXY: "0" };
  const run = (...args) => exec(process.execPath, [cli, "billing", "line-bundles", ...args], { env });
  const key = "a3f22fcb-d805-4811-830c-2c61c3da5316";
  const args = ["purchase", "voip_line_bundle", "--quote", "accepted", "--request-key", key];
  await assert.rejects(run(...args), /--confirm/);
  assert.equal(calls.length, 0);
  await run(...args, "--confirm");
  await run(...args, "--confirm");
  assert.deepEqual(calls[0], { path: "/api/v1/billing/line-bundles", body: { code: "voip_line_bundle", quote: "accepted", request_key: key } });
  assert.deepEqual(calls[0], calls[1]);
});

test("usage alerts preserve explicit off and use delete to restore defaults", async (t) => {
  const calls = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    calls.push({ method: request.method, path: request.url, body: raw ? JSON.parse(raw) : null });
    if (request.method === "DELETE") { response.writeHead(204).end(); return; }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.method === "GET" ? [] : {}));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const env = { ...process.env, INKBOX_API_KEY: "synthetic-test-key", INKBOX_BASE_URL: `http://127.0.0.1:${server.address().port}`, NODE_USE_ENV_PROXY: "0" };
  const run = (...args) => exec(process.execPath, [cli, "billing", "alerts", ...args], { env });
  const id = "a3f22fcb-d805-4811-830c-2c61c3da5316";
  await run("list");
  await run("save", id, "--metric", "identities", "--threshold", "90", "--disabled");
  await run("delete", id);
  assert.equal(calls[0].method, "GET");
  assert.deepEqual(calls[1].body, { metric: "identities", threshold: 90, enabled: false, mailbox_id: null });
  assert.equal(calls[2].method, "DELETE");
  assert.equal(calls[2].path, `/api/v1/billing/usage-alerts/${id}`);
});
