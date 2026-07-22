import assert from "node:assert/strict";
import test from "node:test";
import { execFile, execFileSync } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));

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
  assert.match(merge, /rejected atomically above 25 active\s+memories/);
  assert.match(merge, /delete unwanted facts and retry/);
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
