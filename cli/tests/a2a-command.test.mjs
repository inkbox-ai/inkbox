import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function help(...args) {
  return execFileSync(process.execPath, [cli, ...args, "--help"], {
    encoding: "utf8",
  });
}

test("A2A exposes receiver inbox and caller sent-history commands", () => {
  const text = help("a2a");
  assert.match(text, /tasks/);
  assert.match(text, /task (?:\[options\] )?<task-id>/);
  assert.match(text, /sent/);
  assert.match(text, /sent-task (?:\[options\] )?<task-id>/);
  assert.match(text, /messages/);
  assert.match(text, /filter-mode/);
  assert.match(text, /directory/);
  assert.match(text, /settings/);
  assert.match(text, /publicly-discoverable/);
  assert.match(text, /public-egress/);
});

for (const command of ["tasks", "sent"]) {
  test(`A2A ${command} history exposes peer, search, and pagination filters`, () => {
    const text = help("a2a", command);
    assert.match(text, /--identity <handle>/);
    assert.match(text, /--requester <handle>/);
    assert.match(text, /--worker <handle>/);
    assert.match(text, /--state <state>/);
    assert.match(text, /--context <id>/);
    assert.match(text, /--query <query>/);
    assert.match(text, /--since <datetime>/);
    assert.match(text, /--cursor <cursor>/);
    assert.match(text, /--limit <n>/);
  });
}

test("A2A unified task history exposes direction", () => {
  assert.match(help("a2a", "tasks"), /--direction <direction>/);
});

test("A2A worker replies expose progress updates", () => {
  assert.match(help("a2a", "reply"), /--progress/);
});

test("A2A message history exposes provenance, search, and pagination filters", () => {
  const text = help("a2a", "messages");
  for (const pattern of [
    /--identity <handle>/,
    /--direction <direction>/,
    /--requester <handle>/,
    /--worker <handle>/,
    /--task <id>/,
    /--context <id>/,
    /--role <role>/,
    /--query <query>/,
    /--since <datetime>/,
    /--cursor <cursor>/,
    /--limit <n>/,
  ]) {
    assert.match(text, pattern);
  }
});

test("A2A admission controls expose complete admin operations", () => {
  assert.match(help("a2a", "filter-mode"), /--mode <mode>/);
  assert.match(help("a2a", "skills", "reset"), /--identity <handle>/);
  assert.match(help("a2a", "rules", "add"), /--direction <direction>/);
  assert.match(help("a2a", "rules", "update"), /--action <action>/);
  assert.match(help("a2a", "rules", "update"), /--direction <direction>/);
  assert.match(help("a2a", "rules", "delete"), /--identity <handle>/);
  assert.match(help("a2a", "settings"), /--identity <handle>/);
  assert.match(help("a2a", "publicly-discoverable"), /--identity <handle>/);
  assert.match(help("a2a", "public-egress"), /--identity <handle>/);
});

test("A2A directory exposes search scope and pagination", () => {
  const text = help("a2a", "directory");
  assert.match(text, /--public/);
  assert.match(text, /--query <query>/);
  assert.match(text, /--cursor <cursor>/);
  assert.match(text, /--limit <n>/);
});
