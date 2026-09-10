import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const exec = promisify(execFile);
const fixture = JSON.parse(readFileSync(new URL("../../tests/fixtures/domain-certification.json", import.meta.url), "utf8"));

test("claim commands, explicit publication, and filtered directory use the intended contracts", async (t) => {
  const calls = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const url = new URL(request.url, "http://localhost");
    calls.push({ method: request.method, url, body: raw ? JSON.parse(raw) : null });
    response.setHeader("content-type", "application/json");
    if (request.method === "DELETE") { response.statusCode = 204; response.end(); return; }
    if (url.pathname.endsWith("domain-affiliation")) {
      response.end(JSON.stringify({ domain_claim_id: "claim", domain: "example.com", publish_publicly: false, affiliation: null }));
    } else if (url.pathname === "/a2a/directory") {
      response.end(JSON.stringify({ items: [{ card_url: "https://inkbox.ai/a2a/helper/card", visibility: "public", card: {
        name: "@helper", capabilities: { extensions: [{ uri: "https://inkbox.ai/a2a/extensions/domain-affiliation/v1", params: fixture.affiliation }] },
      } }], next_cursor: "next" }));
    } else if (url.pathname.endsWith("organization-domains") && request.method === "GET") {
      response.end(JSON.stringify({ items: [fixture.claim], next_cursor: "next" }));
    } else { response.end(JSON.stringify(fixture.claim)); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const env = { ...process.env, INKBOX_API_KEY: "test-key", INKBOX_BASE_URL: `http://127.0.0.1:${server.address().port}`, NODE_USE_ENV_PROXY: "0" };
  const run = (...args) => exec(process.execPath, [cli, ...args], { env });
  const claim = JSON.parse((await run("--json", "organization-domain", "create", "example.com")).stdout);
  assert.equal(claim.dnsRecord.name, "_inkbox.example.com");
  for (const action of ["get", "verify", "transfer", "delete"]) await run("--json", "organization-domain", action, "claim");
  await run("organization-domain", "list", "--cursor", "before");
  await assert.rejects(run("identity", "domain-affiliation", "set", "helper", "claim"), /required option/);
  await run("--json", "identity", "domain-affiliation", "set", "@helper", "claim", "--visibility", "hidden");
  await run("identity", "domain-affiliation", "get", "helper");
  await run("identity", "domain-affiliation", "remove", "helper");
  assert.deepEqual(calls.find((call) => call.method === "PUT").body, { domain_claim_id: "claim", publish_publicly: false });
  assert(calls.some((call) => call.url.pathname === "/api/v1/identities/%40helper/domain-affiliation"));
  await assert.rejects(run("a2a", "directory", "--verified-domain", "example.com"), /requires --public/);
  const table = await run("a2a", "directory", "--public", "--verified-domain", "example.com", "--cursor", "next", "--query", "helper");
  assert.match(table.stdout, /example.com/);
  const directory = calls.find((call) => call.url.pathname === "/a2a/directory");
  assert.equal(directory.url.searchParams.get("verified_domain"), "example.com");
  assert.equal(directory.url.searchParams.get("cursor"), "next");
  assert.equal(directory.url.searchParams.get("q"), "helper");
});
