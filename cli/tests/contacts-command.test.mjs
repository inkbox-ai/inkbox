import assert from "node:assert/strict";
import test from "node:test";
import { execFile, execFileSync } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseContactPolicyFile } from "../dist/commands/contacts.js";
import { outputContactRules } from "../dist/output.js";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));

test("policy pagination rejects malformed and out-of-range arguments before HTTP", async () => {
  let requests = 0;
  const mock = await listen((_req, res) => { requests++; res.end("{}"); });
  try {
    for (const command of [["contacts", "communication-policy", "list"], ["contacts", "communication-policy", "list-management"], ["identity", "contact-policies"]]) {
      for (const [flag, value] of [["--limit", "abc"], ["--limit", "1.5"], ["--limit", "0"], ["--limit", "201"], ["--offset", "-1"], ["--offset", "10001"]]) {
        const result = await runCli(["--api-key", "test-key", "--base-url", `http://127.0.0.1:${mock.port}`, ...command, "test-agent", flag, value]);
        assert.ok(result.error);
        assert.match(result.stderr, /must be an integer between/);
      }
    }
    assert.equal(requests, 0);
    assert.match(help("contacts", "communication-policy", "set"), /optional visibility/);
  } finally { await new Promise((resolve) => mock.server.close(resolve)); }
});

test("rule tables show names while JSON preserves the card", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const rows = [{ id: "rule-1", contact: { preferredName: "Person" } }, { id: "rule-2", contact: null }];
  outputContactRules(rows, { json: false, columns: ["id", "contact"] });
  assert.match(lines[2], /rule-1\s+Person/);
  assert.match(lines[3], /rule-2\s+-/);
  lines.length = 0;
  outputContactRules(rows, { json: true, columns: ["id", "contact"] });
  assert.deepEqual(JSON.parse(lines[0]), rows);
});

test("permission management forwards filters and preserves the page in JSON", async () => {
  let request;
  const mock = await listen((req, res) => {
    request = new URL(req.url, "http://localhost");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ items: [], limit: 1, offset: 2, has_more: true }));
  });
  try {
    const result = await runCli(["--api-key", "test-key", "--base-url", `http://127.0.0.1:${mock.port}`, "--json",
      "contacts", "communication-policy", "list-management", "test-agent", "--q", "Person", "--order", "name",
      "--limit", "1", "--offset", "2", "--review-status", "confirmed", "unreviewed"]);
    assert.equal(result.error, null, result.stderr);
    assert.equal(request.pathname, "/api/v1/identities/test-agent/contact-permissions");
    assert.equal(request.searchParams.get("q"), "Person");
    assert.equal(request.searchParams.get("order"), "name");
    assert.deepEqual(request.searchParams.getAll("review_status"), ["confirmed", "unreviewed"]);
    assert.deepEqual(JSON.parse(result.stdout), { items: [], limit: 1, offset: 2, hasMore: true });
  } finally { await new Promise((resolve) => mock.server.close(resolve)); }
});

test("policy files preserve visibility omission and validate every supplied field", () => {
  const base = { expectedRevision: 0, defaults: { email: "inherit", phone: "inherit" }, identities: [] };
  assert.deepEqual(parseContactPolicyFile(JSON.stringify(base)), base);
  const full = { ...base, visibility: { defaults: { profile: "allow", memories: "block" },
    identities: [{ identityId: "identity-1", profile: "block", memories: "allow" }] } };
  assert.deepEqual(parseContactPolicyFile(JSON.stringify(full)), full);
  for (const invalid of [
    { ...base, visiblity: full.visibility }, { ...base, visibility: null },
    { ...full, visibility: { ...full.visibility, defaults: { profile: "allow", memory: "block" } } },
    { ...full, visibility: { ...full.visibility, identities: [{ identityId: "i", profile: "allow", memories: "block", typo: true }] } },
    { ...base, defaults: { email: "allow" } }, { ...base, expectedRevision: -1 },
  ]) assert.throws(() => parseContactPolicyFile(JSON.stringify(invalid)));
});

test("policy set forwards visibility and rejects unknown keys before HTTP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "contact-policy-"));
  const path = join(directory, "policy.json");
  const body = { expectedRevision: 3, defaults: { email: "allow", phone: "allow" }, identities: [],
    visibility: { defaults: { profile: "allow", memories: "block" }, identities: [{ identityId: "identity-1", profile: "block", memories: "allow" }] } };
  const requests = [];
  const mock = await listen(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ method: req.method, url: req.url, payload });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ contact_id: "contact-1", revision: 4, defaults: payload.defaults, identities: [], visibility: payload.visibility }));
  });
  try {
    const args = ["--api-key", "test-key", "--base-url", `http://127.0.0.1:${mock.port}`, "--json",
      "contacts", "communication-policy", "set", "contact-1", "--file", path];
    await writeFile(path, JSON.stringify(body));
    const result = await runCli(args);
    assert.equal(result.error, null, result.stderr);
    assert.deepEqual(requests[0], { method: "PUT", url: "/api/v1/contacts/contact-1/communication-policy", payload: {
      expected_revision: 3, defaults: body.defaults, identities: [], visibility: {
        defaults: body.visibility.defaults, identities: [{ identity_id: "identity-1", profile: "block", memories: "allow" }],
      },
    } });
    await writeFile(path, JSON.stringify({ ...body, visiblity: body.visibility }));
    const invalid = await runCli(args);
    assert.notEqual(invalid.error, null);
    assert.match(invalid.stderr, /Unknown field/);
    assert.equal(requests.length, 1);
  } finally {
    await new Promise((resolve) => mock.server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

function help(...args) {
  return execFileSync(process.execPath, [cli, ...args, "--help"], {
    encoding: "utf8",
  });
}

function runCli(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, ...args],
      {
        env: {
          ...process.env,
          NODE_USE_ENV_PROXY: "0",
        },
        timeout: 15_000,
      },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    );
  });
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

test("contacts exposes contact-memory commands", () => {
  const text = help("contacts");
  assert.match(text, /facts/);
  assert.match(text, /correspondence/);
  assert.match(text, /merge/);
  assert.match(text, /communication-policy/);
});

test("contact communication policy reads use the administrative policy endpoint", async () => {
  let request;
  const mock = await listen((req, res) => {
    request = { method: req.method, url: req.url };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      contact_id: "contact-1", revision: 3,
      defaults: { email: "block", phone: "block" },
      identities: [{ identity_id: "identity-1", email: "allow", phone: "block" }],
      visibility: { defaults: { profile: "inherit", memories: "inherit" }, identities: [] },
    }));
  });
  try {
    const result = await runCli([
      "--api-key", "test-key", "--base-url", `http://127.0.0.1:${mock.port}`, "--json",
      "contacts", "communication-policy", "get", "contact-1",
    ]);
    assert.equal(result.error, null, result.stderr);
    assert.deepEqual(request, { method: "GET", url: "/api/v1/contacts/contact-1/communication-policy" });
    const policy = JSON.parse(result.stdout);
    assert.equal(policy.revision, 3);
    assert.equal(policy.identities[0].identityId, "identity-1");
  } finally {
    await new Promise((resolve) => mock.server.close(resolve));
  }
});

test("contact facts exposes read and deletion commands", () => {
  const text = help("contacts", "facts");
  assert.match(text, /list (?:\[options\] )?<contact-id>/);
  assert.match(text, /get <contact-id> <fact-id>/);
  assert.match(text, /citation <contact-id> <fact-id> <citation-id>/);
  assert.match(text, /citation-url <source-url>/);
  assert.match(text, /delete <contact-id> <fact-id>/);
  assert.match(help("contacts", "facts", "delete"), /admin-scoped API key required/);
});

test("contact facts exposes hand-written memory commands", () => {
  const text = help("contacts", "facts");
  assert.match(text, /create (?:\[options\] )?<contact-id>/);
  assert.match(text, /update (?:\[options\] )?<contact-id> <fact-id>/);
  assert.match(help("contacts", "facts", "list"), /--include-expired/);
  assert.match(help("contacts", "facts", "create"), /--kind <kind>/);
  assert.match(help("contacts", "facts", "create"), /admin-scoped API key required/);
  assert.match(help("contacts", "facts", "update"), /admin-scoped API key required/);
  assert.match(help("contacts", "facts", "update"), /manually\s+maintained and revives it/);
  assert.match(help("contacts", "facts", "list"), /locked facts remain\s+active/);
});

test("contact fact creation posts content and kind", async () => {
  let request;
  const mock = await listen((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      request = { method: req.method, url: req.url, body: JSON.parse(body) };
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "fact-1",
        contact_id: "contact-1",
        content: "Prefers email",
        confidence: null,
        origin: "user",
        kind: "preference",
        expires_at: null,
        locked_at: null,
        created_at: "2026-07-21T12:00:00Z",
        updated_at: "2026-07-21T12:00:00Z",
        citations: [],
      }));
    });
  });

  try {
    const result = await runCli([
      "--api-key", "test-key",
      "--base-url", `http://127.0.0.1:${mock.port}`,
      "--json",
      "contacts", "facts", "create", "contact-1",
      "--content", "Prefers email",
      "--kind", "preference",
    ]);

    assert.ifError(result.error);
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/v1/contacts/contact-1/facts");
    assert.deepEqual(request.body, { content: "Prefers email", kind: "preference" });
    assert.equal(JSON.parse(result.stdout).kind, "preference");
  } finally {
    mock.server.close();
  }
});

test("contact fact commands reject an unknown kind and an empty update", async () => {
  const badKind = await runCli([
    "--api-key", "test-key",
    "contacts", "facts", "create", "contact-1",
    "--content", "Prefers email",
    "--kind", "nickname",
  ]);
  assert.ok(badKind.error);
  assert.match(badKind.stderr, /--kind must be one of: profile, preference, context/);

  const emptyUpdate = await runCli([
    "--api-key", "test-key",
    "contacts", "facts", "update", "contact-1", "fact-1",
  ]);
  assert.ok(emptyUpdate.error);
  assert.match(emptyUpdate.stderr, /Pass --content, --kind, or both/);
});

test("contact lifecycle options are discoverable", () => {
  assert.match(help("contacts", "list"), /--review-status <status>/);
  assert.doesNotMatch(help("contacts", "get"), /--include-dismissed/);
  assert.doesNotMatch(help("contacts", "correspondence"), /--include-dismissed/);
  assert.doesNotMatch(help("contacts", "facts", "list"), /--include-dismissed/);
  assert.doesNotMatch(help("contacts", "create"), /--idempotency-key/);
  assert.doesNotMatch(help("contacts", "update", "contact-id"), /--idempotency-key/);
  assert.doesNotMatch(help("contacts", "delete", "contact-id"), /--idempotency-key/);
  assert.doesNotMatch(help("contacts", "import", "contacts.vcf"), /--idempotency-key/);
});

test("contacts exposes bulk deletion and batch export", () => {
  const text = help("contacts");
  assert.match(text, /bulk-delete <contact-id\.\.\.>/);
  assert.match(text, /export-many (?:\[options\] )?<contact-id\.\.\.>/);
});

test("contact access retains list and removes mutation commands", () => {
  const text = help("contacts", "access");
  assert.match(text, /list <contact-id>/);
  assert.doesNotMatch(text, /^\s+grant(?:\s|$)/m);
  assert.doesNotMatch(text, /^\s+revoke(?:\s|$)/m);
});

test("contact correspondence and merge expose their request options", () => {
  const correspondence = help("contacts", "correspondence");
  assert.match(correspondence, /--channels <channel>/);
  assert.match(correspondence, /--limit-per-channel <n>/);
  assert.match(correspondence, /--transcripts <mode>/);

  const merge = help("contacts", "merge");
  assert.match(merge, /--losing <contact-id\.\.\.>/);
  assert.match(merge, /--field-sources <json>/);
  assert.match(merge, /admin-scoped key required/);
  assert.match(merge, /rejected\s+when\s+a\s+memory\s+kind\s+or\s+total\s+goes\s+over/);
  assert.match(merge, /any\s+active\s+fact\s+for\s+total/);
});

test("contact fact deletion calls the API and prints remaining memory", async () => {
  let request;
  const mock = await listen((req, res) => {
    request = { method: req.method, url: req.url };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      deleted_fact_id: "fact-1",
      memory_count: 1,
      latest_memory: {
        id: "fact-2",
        content: "Prefers email",
        updated_at: "2026-07-21T12:00:00Z",
      },
    }));
  });

  try {
    const result = await runCli([
      "--api-key", "test-key",
      "--base-url", `http://127.0.0.1:${mock.port}`,
      "--json",
      "contacts", "facts", "delete", "contact-1", "fact-1",
    ]);

    assert.ifError(result.error);
    assert.equal(result.stderr, "");
    assert.deepEqual(request, {
      method: "DELETE",
      url: "/api/v1/contacts/contact-1/facts/fact-1",
    });
    const output = JSON.parse(result.stdout);
    assert.equal(output.deletedFactId, "fact-1");
    assert.equal(output.memoryCount, 1);
    assert.equal(output.latestMemory.content, "Prefers email");
  } finally {
    mock.server.close();
  }
});
