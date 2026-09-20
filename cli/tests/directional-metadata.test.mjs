import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseContactAccessFile, parseContactPolicyFile } from "../dist/commands/contacts.js";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const notice = { code: "directional_permissions", level: "future_level", message: "Receiving and sending differ." };
const rule = {
  id: "rule-1", agent_identity_id: "identity-1", mailbox_id: "mailbox-1", phone_number_id: "number-1",
  action: "allow", direction: "both", match_type: "exact_number", match_target: "+15555550123", status: "active",
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};
async function run(baseUrl, args) {
  return new Promise((resolve) => execFile(process.execPath, [cli, "--base-url", baseUrl, "--api-key", "test-key", ...args], {
    timeout: 15000, env: { ...process.env, NODE_USE_ENV_PROXY: "0", INKBOX_VAULT_KEY: "" },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
}
async function serve(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
function respond(response, body, status = 200, notices = [notice]) {
  response.writeHead(status, { "Content-Type": "application/json", ...(notices ? { "Inkbox-Notices": JSON.stringify(notices) } : {}) });
  response.end(status === 204 ? undefined : JSON.stringify(body));
}

test("notice output preserves ordinary stdout and opts into one JSON envelope", async () => {
  await serve((_req, res) => respond(res, [rule]), async (url) => {
    const args = ["identity", "phone-rules", "list", "example-agent"];
    const normal = await run(url, args);
    assert.ifError(normal.error);
    assert.match(normal.stdout, /direction/);
    assert.match(normal.stdout, /both/);
    assert.match(normal.stderr, /Notice \(future_level\): Receiving and sending differ/);
    const plain = await run(url, ["--json", ...args]);
    assert.ifError(plain.error);
    assert.ok(Array.isArray(JSON.parse(plain.stdout)));
    assert.deepEqual(JSON.parse(plain.stderr), { notices: [notice] });
    const wrapped = await run(url, ["--json", "--with-response-metadata", ...args]);
    assert.ifError(wrapped.error);
    assert.deepEqual(JSON.parse(wrapped.stdout), { data: JSON.parse(plain.stdout), notices: [notice] });
    assert.equal(wrapped.stderr, "");
  });
});

test("empty success and API errors preserve their status and error guidance", async () => {
  await serve((req, res) => respond(res, req.method === "DELETE" ? null : {
    detail: "Denied", agent_support: "Contact support.",
  }, req.method === "DELETE" ? 204 : 403), async (url) => {
    const deleted = await run(url, ["--json", "--with-response-metadata", "identity", "phone-rules", "delete", "example-agent", "rule-1"]);
    assert.ifError(deleted.error);
    assert.deepEqual(JSON.parse(deleted.stdout), { data: null, notices: [notice] });
    assert.equal(deleted.stderr, "");
    const oldDelete = await run(url, ["--json", "identity", "phone-rules", "delete", "example-agent", "rule-1"]);
    assert.match(oldDelete.stdout, /^Deleted phone contact rule/);
    assert.deepEqual(JSON.parse(oldDelete.stderr), { notices: [notice] });
    for (const flags of [["--json"], ["--json", "--with-response-metadata"]]) {
      const error = await run(url, [...flags, "identity", "phone-rules", "list", "example-agent"]);
      assert.equal(error.error?.code, 1);
      assert.equal(error.stdout, "");
      const envelope = JSON.parse(error.stderr);
      assert.equal(envelope.error.statusCode, 403);
      assert.equal(envelope.error.agentSupport, "Contact support.");
      assert.deepEqual(envelope.notices, [notice]);
    }
  });
});

test("metadata validation rejects raw certificate output before requests", async () => {
  let requests = 0;
  await serve((_req, res) => { requests++; respond(res, []); }, async (url) => {
    for (const args of [
      ["--with-response-metadata", "identity", "list"],
      ["--json", "--with-response-metadata", "tunnel", "sign-csr", "tunnel-1", "--csr", "unused"],
    ]) {
      const result = await run(url, args);
      assert.equal(result.error?.code, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /--with-response-metadata/);
    }
    assert.equal(requests, 0);
  });
});

test("old responses omit notices and malformed metadata stays advisory", async () => {
  let header = null;
  await serve((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", ...(header ? { "Inkbox-Notices": header } : {}) });
    res.end("[]");
  }, async (url) => {
    for (header of [null, "null", "[]", "invalid", '[{"code":1}]']) {
      const result = await run(url, ["--json", "--with-response-metadata", "identity", "list"]);
      assert.ifError(result.error);
      assert.deepEqual(JSON.parse(result.stdout), { data: [] });
      assert.equal(result.stderr, "");
    }
    header = JSON.stringify([{ ...notice, message: "hello\u001b[31m\nworld" }]);
    const result = await run(url, ["identity", "list"]);
    assert.ifError(result.error);
    assert.match(result.stderr, /hello\\u001b\[31m\\u000aworld/);
    assert.ok(!result.stderr.includes("\u001b"));
  });
});

test("all rule command families serialize direction-only and atomic updates", async () => {
  const requests = [];
  await serve(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, method: req.method, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null });
    respond(res, req.method === "GET" ? [rule] : rule, req.method === "POST" ? 201 : 200, null);
  }, async (url) => {
    for (const [prefix, target] of [
      [["identity", "mail-rules"], ["example-agent"]],
      [["identity", "phone-rules"], ["example-agent"]],
      [["mailbox", "rules"], ["--mailbox", "x@example.com"]],
      [["number", "rules"], ["--number", "number-1"]],
      [["imessage", "contact-rule"], ["--identity", "example-agent"]],
    ]) {
      for (const flags of [["--direction", "inbound"], ["--action", "block", "--apply-to", "outbound"]]) {
        const result = await run(url, ["--json", ...prefix, "update", ...target, "rule-1", ...flags]);
        assert.ifError(result.error);
        assert.deepEqual(requests.at(-1).body, flags[0] === "--direction" ? { direction: "inbound" } : { action: "block", apply_to: "outbound" });
        assert.equal(JSON.parse(result.stdout).id, rule.id);
      }
      const result = await run(url, ["--json", ...prefix, "list", ...target, "--direction", "inbound"]);
      assert.ifError(result.error);
      assert.match(requests.at(-1).url, /direction=inbound/);
      const count = requests.length;
      const invalid = await run(url, ["--json", ...prefix, "update", ...target, "rule-1", "--apply-to", "inbound"]);
      assert.equal(invalid.error?.code, 1);
      assert.equal(requests.length, count);
    }
  });
});

test("directional access and policy files preserve omitted opposite-side choices", () => {
  const access = { email: { inboundContactable: ["x@example.com"], outboundContactable: [] } };
  assert.deepEqual(parseContactAccessFile(JSON.stringify(access)), access);
  for (const email of [{ inboundContactable: null }, { contactable: [], outboundContactable: [] }, { visible: false, inboundContactable: ["x@example.com"] }]) {
    assert.throws(() => parseContactAccessFile(JSON.stringify({ email })));
  }
  const policy = { expectedRevision: 1, identityId: "identity-1", addresses: [{ kind: "email", value: "x@example.com", action: "allow", direction: "both", expectedInboundAction: "allow", expectedOutboundAction: "block" }] };
  assert.deepEqual(parseContactPolicyFile(JSON.stringify(policy)), policy);
});

test("split contact access exposes declared body notices after parsing", async () => {
  await serve((_req, res) => respond(res, {
    email: { visible: true, contactable: [], inbound_contactable: ["x@example.com"], outbound_contactable: [] },
    phone: { visible: false, contactable: [] }, profile: true, memories: false, notices: [notice],
  }, 200, null), async (url) => {
    const result = await run(url, ["--json", "--with-response-metadata", "contacts", "access", "get", "example-agent", "contact-1"]);
    assert.ifError(result.error);
    const envelope = JSON.parse(result.stdout);
    assert.deepEqual(envelope.notices, [notice]);
    assert.deepEqual(envelope.data.email, { visible: true, contactable: [], inboundContactable: ["x@example.com"], outboundContactable: [] });
    assert.equal(result.stderr, "");
  });
});

test("identity mode flags map to canonical wire fields and reject same-channel mixtures before HTTP", async () => {
  const requests = [];
  await serve(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null });
    respond(res, {
      id: "identity-1", agent_handle: "example-agent", organization_id: "org-example", display_name: null,
      description: null, email_address: "x@example.com", mailbox: null, phone_number: null, tunnel: null,
      created_at: rule.created_at, updated_at: rule.updated_at,
      mail_filter_mode: "whitelist", phone_filter_mode: "blacklist",
      mail_inbound_filter_mode: "blacklist", mail_outbound_filter_mode: "whitelist",
    });
  }, async (url) => {
    const args = ["--json", "--with-response-metadata", "identity", "update", "example-agent"];
    const result = await run(url, [...args, "--mail-inbound-filter-mode", "blacklist", "--mail-outbound-filter-mode", "whitelist",
      "--phone-inbound-filter-mode", "whitelist", "--phone-outbound-filter-mode", "blacklist"]);
    assert.ifError(result.error);
    assert.deepEqual(requests.at(-1).body, {
      mail_inbound_filter_mode: "blacklist", mail_outbound_filter_mode: "whitelist",
      phone_inbound_filter_mode: "whitelist", phone_outbound_filter_mode: "blacklist",
    });
    assert.deepEqual(JSON.parse(result.stdout), { data: null, notices: [notice] });
    assert.equal(result.stderr, "");
    assert.equal(requests.length, 2);
    const invalid = await run(url, [...args, "--imessage-filter-mode", "whitelist", "--phone-inbound-filter-mode", "blacklist"]);
    assert.equal(invalid.error?.code, 1);
    assert.equal(requests.length, 2);
    const get = await run(url, ["--json", "identity", "get", "example-agent"]);
    assert.ifError(get.error);
    assert.equal(JSON.parse(get.stdout).mailInboundFilterMode, "blacklist");
    assert.equal(JSON.parse(get.stdout).mailOutboundFilterMode, "whitelist");
  });
});
