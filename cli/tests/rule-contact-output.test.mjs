import assert from "node:assert/strict";
import { test } from "node:test";
import { outputContactRules } from "../dist/output.js";

test("rule tables show contact names and JSON preserves cards", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const rows = [
    { id: "rule-1", contact: { id: "contact-1", preferredName: "Person" } },
    { id: "rule-2", contact: null },
    { id: "rule-3" },
  ];
  outputContactRules(rows, { json: false, columns: ["id", "contact"] });
  assert.match(lines[2], /rule-1\s+Person/);
  assert.match(lines[3], /rule-2\s+-/);
  assert.match(lines[4], /rule-3\s+-/);
  lines.length = 0;
  outputContactRules(rows, { json: true, columns: ["id", "contact"] });
  assert.deepEqual(JSON.parse(lines[0]), rows);
});
