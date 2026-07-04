import assert from "node:assert/strict";
import test from "node:test";
import {
  contentTypeForPath,
  parseInlineImageSpec,
} from "../dist/commands/email.js";

test("contentTypeForPath infers common image types", () => {
  assert.equal(contentTypeForPath("chart.png"), "image/png");
  assert.equal(contentTypeForPath("photo.JPG"), "image/jpeg");
  assert.equal(contentTypeForPath("anim.gif"), "image/gif");
  assert.equal(contentTypeForPath("doc.pdf"), "application/pdf");
});

test("contentTypeForPath falls back to octet-stream for unknown extensions", () => {
  assert.equal(contentTypeForPath("mystery.xyz"), "application/octet-stream");
  assert.equal(contentTypeForPath("noext"), "application/octet-stream");
});

test("parseInlineImageSpec splits cid=path", () => {
  assert.deepEqual(parseInlineImageSpec("chart=./chart.png"), {
    cid: "chart",
    path: "./chart.png",
  });
});

test("parseInlineImageSpec trims whitespace", () => {
  assert.deepEqual(parseInlineImageSpec(" logo = /tmp/logo.png "), {
    cid: "logo",
    path: "/tmp/logo.png",
  });
});

test("parseInlineImageSpec rejects malformed specs", () => {
  assert.throws(() => parseInlineImageSpec("no-equals"));
  assert.throws(() => parseInlineImageSpec("=/path/only"));
  assert.throws(() => parseInlineImageSpec("cid-only="));
});
