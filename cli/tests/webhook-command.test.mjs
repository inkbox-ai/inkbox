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
  hasAuthToken: true,
  authToken: "your-endpoint-token",
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
  // reads return the token; the flattened shape carries both fields
  assert.equal(flat.hasAuthToken, true);
  assert.equal(flat.authToken, "your-endpoint-token");
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

test("resolveAuthTokenInput is a no-op without the stdin flag", async () => {
  // There is no literal-token option: the secret only ever arrives on stdin.
  const { resolveAuthTokenInput } = await import("../dist/commands/webhook.js");
  assert.equal(await resolveAuthTokenInput({}), undefined);
});

test("webhook CLI sends mixed identity events and direct mutations", async (t) => {
  const http = await import("node:http");
  const { execFile } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const requests = [];
  let catalog = { supports_identity_subscriptions: true };
  const row = {
    id: "11111111-1111-1111-1111-111111111111", organization_id: "org_test",
    agent_identity_id: "33333333-3333-3333-3333-333333333333",
    mailbox_id: null, phone_number_id: null,
    url: "https://example.com/events", event_types: ["message.received", "a2a.task.created"],
    status: "active", created_at: "2026-09-15T00:00:00Z", updated_at: "2026-09-15T00:00:00Z",
  };
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, body: body ? JSON.parse(body) : null });
    response.writeHead(request.method === "DELETE" ? 204 : 200, { "Content-Type": "application/json" });
    response.end(request.method === "DELETE" ? undefined : JSON.stringify(
      request.url === "/api/v1/webhooks/catalog" ? catalog :
      request.method === "GET" ? { subscriptions: [row] } : row));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const run = (args, json = true) => new Promise((resolve, reject) => execFile(process.execPath,
    [cli, "--api-key", "test-key", "--base-url", `http://127.0.0.1:${server.address().port}`,
      ...(json ? ["--json"] : []), "webhook", "subscription", ...args],
    { env: { ...process.env, NODE_USE_ENV_PROXY: "0" }, timeout: 15_000 },
    (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout)));
  const created = JSON.parse(await run(["create", "--agent-identity-id", row.agent_identity_id,
    "--url", row.url, "--event-type", "message.received", "--event-type", "a2a.task.created"]));
  assert.deepEqual(created.eventTypes, row.event_types);
  assert.deepEqual(requests[0].body, { agent_identity_id: row.agent_identity_id,
    url: row.url, event_types: row.event_types });
  await run(["update", row.id, "--event-type", "message.received"]);
  assert.deepEqual(requests[1].body, { event_types: ["message.received"] });
  await run(["delete", row.id]);
  assert.equal(requests[2].method, "DELETE");
  assert.equal(requests[2].url, `/api/v1/webhooks/subscriptions/${row.id}`);
  await run(["list", "--agent-identity-id", row.agent_identity_id]);
  const legacyQuery = new URL(requests[3].url, "https://example.com").searchParams;
  assert.equal(legacyQuery.get("agent_identity_id"), row.agent_identity_id);
  assert.equal(legacyQuery.has("scope"), false);
  const listed = JSON.parse(await run(["list", "--agent-identity-id", row.agent_identity_id,
    "--scope", "identity"]));
  assert.deepEqual(listed[0].eventTypes, row.event_types.join(", "));
  assert.equal(requests[4].url, "/api/v1/webhooks/catalog");
  assert.equal(new URL(requests[5].url, "https://example.com").searchParams.get("scope"), "identity");
  for (const unsupported of [{}, { supports_identity_subscriptions: false }]) {
    catalog = unsupported;
    const before = requests.length;
    await assert.rejects(run(["list", "--scope", "identity"]), /channel-filtered lists without scope/);
    assert.equal(requests.length, before + 1);
    assert.equal(requests.at(-1).url, "/api/v1/webhooks/catalog");
  }
  await assert.rejects(run(["list", "--scope", "unsupported"]), /Allowed choices are identity/);
  row.agent_identity_id = null;
  for (const owner of ["mailbox_id", "phone_number_id"]) {
    row.mailbox_id = null; row.phone_number_id = null;
    row[owner] = "22222222-2222-2222-2222-222222222222";
    const table = await run(["list"], false);
    assert.match(table, /22222222-2222-2222-2222-222222222222/);
    assert.match(table, owner === "mailbox_id" ? /mailboxId/ : /phoneNumberId/);
  }
});
