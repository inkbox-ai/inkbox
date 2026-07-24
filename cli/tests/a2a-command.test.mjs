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
});

test("A2A sent history supports identity and state selection", () => {
  const text = help("a2a", "sent");
  assert.match(text, /--identity <handle>/);
  assert.match(text, /--state <state>/);
});
