import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("../../tests/fixtures/identity_packs.json", import.meta.url), "utf8"));
const exec = promisify(execFile);
const requestKey = "22222222-2222-4222-8222-222222222222";
const resumeKey = "33333333-3333-4333-8333-333333333333";
const agreementId = fixture.mutation.agreement_id;

async function mockApi(t, respond) {
  const calls = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const call = { path: request.url, method: request.method, body: raw ? JSON.parse(raw) : null };
    calls.push(call);
    assert.equal(request.headers["x-api-key"], "synthetic-admin-key");
    response.setHeader("content-type", "application/json");
    respond(call, response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const env = { ...process.env, INKBOX_API_KEY: "synthetic-admin-key", INKBOX_BASE_URL: `http://127.0.0.1:${server.address().port}`, NODE_USE_ENV_PROXY: "0" };
  const run = (...args) => exec(process.execPath, [cli, "--json", "billing", "identity-packs", ...args], { env });
  return { calls, run };
}

test("identity packs list pagination, quote, confirmed purchase and payment URL", async (t) => {
  const { calls, run } = await mockApi(t, (call, response) => {
    response.statusCode = call.method === "GET" || call.path.endsWith("/quote") ? 200 : 202;
    response.end(JSON.stringify(call.method === "GET" ? fixture.list : call.path.endsWith("/quote") ? fixture.quote : fixture.mutation));
  });
  assert.deepEqual(JSON.parse((await run("list")).stdout), fixture.list);
  assert.equal(calls[0].path, "/api/v1/billing/identity-packs");
  await run("list", "--cursor", agreementId, "--limit", "1");
  const url = new URL(calls[1].path, "https://example.com");
  assert.deepEqual(Object.fromEntries(url.searchParams), { cursor: agreementId, limit: "1" });
  await assert.rejects(run("list", "--limit", "0"), /Expected an integer/);
  assert.deepEqual(JSON.parse((await run("quote")).stdout), fixture.quote);
  assert.deepEqual(calls[2], { path: "/api/v1/billing/identity-packs/quote", method: "POST", body: {} });
  const args = ["purchase", "--quote", fixture.quote.quote, "--request-key", requestKey];
  await assert.rejects(run(...args), /--confirm/);
  await assert.rejects(run("purchase", "--quote", fixture.quote.quote, "--confirm"), /--request-key/);
  await assert.rejects(run("purchase", "--quote", fixture.quote.quote, "--request-key", "invalid", "--confirm"), /Expected a UUID/);
  assert.equal(calls.length, 3);
  for (let i = 0; i < 2; i++) {
    const result = await run(...args, "--confirm", "--success-url", "https://example.com/complete", "--cancel-url", "https://example.com/cancel");
    assert.deepEqual(JSON.parse(result.stdout), { ...fixture.mutation, request_key: requestKey });
  }
  assert.deepEqual(calls[3], {
    path: "/api/v1/billing/identity-packs", method: "POST", body: {
      quote: fixture.quote.quote, request_key: requestKey,
      success_url: "https://example.com/complete", cancel_url: "https://example.com/cancel",
    },
  });
  assert.deepEqual(calls[3], calls[4]);
});

test("identity pack cancellation and resume require and preserve separate retry keys", async (t) => {
  const { calls, run } = await mockApi(t, (call, response) => {
    response.statusCode = 202;
    response.end(JSON.stringify({ agreement_id: agreementId, status: call.path.endsWith("/cancel") ? "canceling" : "active", payment_url: null }));
  });
  for (const action of ["cancel", "resume"]) {
    await assert.rejects(run(action, agreementId), /--request-key/);
  }
  assert.equal(calls.length, 0);
  for (const [action, key] of [["cancel", requestKey], ["resume", resumeKey], ["cancel", requestKey], ["resume", resumeKey]]) {
    const result = JSON.parse((await run(action, agreementId, "--request-key", key)).stdout);
    assert.equal(result.request_key, key);
    assert.equal(result.payment_url, null);
    assert.deepEqual(calls.at(-1), { path: `/api/v1/billing/identity-packs/${agreementId}/${action}`, method: "POST", body: { request_key: key } });
  }
  assert.deepEqual(calls[0], calls[2]);
  assert.deepEqual(calls[1], calls[3]);
});

test("identity pack errors retain the request key and retry sends the same body", async (t) => {
  let status = 504;
  let detail = "Response unavailable";
  const { calls, run } = await mockApi(t, (_call, response) => {
    response.statusCode = status;
    response.end(JSON.stringify(status === 202 ? fixture.mutation : { detail }));
  });
  const args = ["purchase", "--quote", fixture.quote.quote, "--request-key", requestKey, "--confirm"];
  for (const [code, body] of [[504, "Response unavailable"], [401, "Invalid API key"], [403, "Organization-admin API key required"], [409, fixture.conflict]]) {
    status = code;
    detail = body;
    await assert.rejects(run(...args), error => {
      const result = JSON.parse(error.stderr);
      assert.equal(result.error.requestKey, requestKey);
      assert.equal(result.error.statusCode, status);
      assert.deepEqual(result.error.detail, detail);
      return true;
    });
  }
  status = 202;
  assert.equal(JSON.parse((await run(...args)).stdout).status, "requires_payment");
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.deepEqual(call.body, { quote: fixture.quote.quote, request_key: requestKey });
  }
});

test("identity pack lost responses expose the original key for a deliberate retry", async (t) => {
  let interrupted = true;
  const { calls, run } = await mockApi(t, (_call, response) => {
    if (interrupted) {
      response.destroy();
      return;
    }
    response.statusCode = 202;
    response.end(JSON.stringify(fixture.mutation));
  });
  const args = ["purchase", "--quote", fixture.quote.quote, "--request-key", requestKey, "--confirm"];
  await assert.rejects(run(...args), error => {
    const result = JSON.parse(error.stderr);
    assert.equal(result.error.type, "InkboxConnectionError");
    assert.equal(result.error.requestKey, requestKey);
    assert.equal(error.stdout, "");
    return true;
  });
  assert.equal(calls.length, 1);
  interrupted = false;
  assert.equal(JSON.parse((await run(...args)).stdout).request_key, requestKey);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
});
