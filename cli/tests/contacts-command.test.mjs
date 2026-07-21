import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function help(...args) {
  return execFileSync(process.execPath, [cli, ...args, "--help"], {
    encoding: "utf8",
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
});

test("contact lifecycle options are discoverable", () => {
  assert.match(help("contacts", "list"), /--review-status <status>/);
  assert.doesNotMatch(help("contacts", "get"), /--include-dismissed/);
  assert.doesNotMatch(help("contacts", "correspondence"), /--include-dismissed/);
  assert.doesNotMatch(help("contacts", "facts", "list"), /--include-dismissed/);
  assert.match(help("contacts", "create"), /--idempotency-key <key>/);
  assert.match(help("contacts", "update", "contact-id"), /--idempotency-key <key>/);
  assert.match(help("contacts", "delete", "contact-id"), /--idempotency-key <key>/);
  assert.match(help("contacts", "import", "contacts.vcf"), /--idempotency-key <key>/);
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
});
