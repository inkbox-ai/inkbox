import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreateOutput,
  flattenCreateForOutput,
  parseContextSpec,
} from "../dist/commands/webhook.js";

// A first-create response: the one-time plaintext signingKey is present.
const CREATE_ROW = {
  id: "sub_1",
  organizationId: "org_x",
  mailboxId: "mbx_1",
  phoneNumberId: null,
  agentIdentityId: null,
  ownerIdentityId: "id_1",
  url: "https://example.com/hook",
  eventTypes: ["message.received", "message.sent"],
  status: "active",
  contextConfig: {
    email: { mode: "count", count: 10 },
    texts: { mode: "window", hours: 24 },
  },
  createdAt: new Date("2026-06-02T03:04:05Z"),
  updatedAt: new Date("2026-06-02T03:04:05Z"),
  signingKey: "whsec_first_create_plaintext",
};

test("flattenCreateForOutput keeps the one-time signingKey and ownerIdentityId", () => {
  const flat = flattenCreateForOutput(CREATE_ROW);
  assert.equal(flat.signingKey, "whsec_first_create_plaintext");
  assert.equal(flat.ownerIdentityId, "id_1");
  // human display joins eventTypes into a string
  assert.equal(flat.eventTypes, "message.received, message.sent");
  assert.equal(
    flat.contextConfig,
    JSON.stringify({
      email: { mode: "count", count: 10 },
      texts: { mode: "window", hours: 24 },
    }),
  );
});

test("buildCreateOutput human output includes signingKey", () => {
  const { data, json } = buildCreateOutput(CREATE_ROW, false);
  assert.equal(json, false);
  assert.equal(data.signingKey, "whsec_first_create_plaintext");
  assert.equal(data.ownerIdentityId, "id_1");
});

test("buildCreateOutput --json preserves the SDK shape including signingKey", () => {
  const { data, json } = buildCreateOutput(CREATE_ROW, true);
  assert.equal(json, true);
  // raw SDK object: signingKey present and eventTypes stays an array
  assert.equal(data.signingKey, "whsec_first_create_plaintext");
  assert.equal(data.ownerIdentityId, "id_1");
  assert.deepEqual(data.eventTypes, ["message.received", "message.sent"]);
  assert.deepEqual(data.contextConfig, {
    email: { mode: "count", count: 10 },
    texts: { mode: "window", hours: 24 },
  });
});

test("parseContextSpec accepts count and window specs", () => {
  assert.deepEqual(parseContextSpec("count:10"), { mode: "count", count: 10 });
  assert.deepEqual(parseContextSpec("window:24"), { mode: "window", hours: 24 });
});

test("parseContextSpec leaves bounds validation to the SDK", () => {
  assert.deepEqual(parseContextSpec("count:0"), { mode: "count", count: 0 });
  assert.deepEqual(parseContextSpec("window:999"), { mode: "window", hours: 999 });
});

test("parseContextSpec rejects malformed specs", () => {
  for (const value of [
    "count",
    "window",
    "count:",
    "window:",
    "count:abc",
    "count:1.5",
    "latest:10",
    "count:-1",
  ]) {
    assert.throws(
      () => parseContextSpec(value),
      /Invalid context spec/,
      value,
    );
  }
});
