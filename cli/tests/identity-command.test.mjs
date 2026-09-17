import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const HANDLE = "sales-bot";
const IDENTITY = {
  id: "11111111-1111-1111-1111-111111111111",
  organization_id: "org_test",
  agent_handle: HANDLE,
  display_name: null,
  description: null,
  email_address: null,
  imessage_enabled: false,
  imessage_filter_mode: "whitelist",
  mail_filter_mode: "whitelist",
  phone_filter_mode: "whitelist",
  mail_inbound_filter_mode: "whitelist",
  mail_outbound_filter_mode: "supervised",
  phone_inbound_filter_mode: "supervised",
  phone_outbound_filter_mode: "supervised",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  mailbox: null,
  phone_number: null,
  imessage_number: null,
  tunnel: null,
};

async function runCli(args, identity = IDENTITY) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
    res.setHeader("content-type", "application/json");
    res.writeHead(200).end(JSON.stringify(identity));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const child = spawn(process.execPath, [
    cli,
    "--json",
    "--api-key", "ApiKey_test",
    "--base-url", `http://127.0.0.1:${server.address().port}`,
    ...args,
  ]);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [exitCode] = await once(child, "close");
  server.close();
  return { exitCode, stdout, stderr, requests };
}

test("identity get prints the directional filter modes", async () => {
  const { exitCode, stdout } = await runCli(["identity", "get", HANDLE]);

  assert.equal(exitCode, 0);
  const record = JSON.parse(stdout);
  assert.equal(record.phoneFilterMode, "whitelist");
  assert.equal(record.mailInboundFilterMode, "whitelist");
  assert.equal(record.mailOutboundFilterMode, "supervised");
  assert.equal(record.phoneInboundFilterMode, "supervised");
  assert.equal(record.phoneOutboundFilterMode, "supervised");
});

test("identity get falls back to the single mode for a response without directional modes", async () => {
  const {
    mail_inbound_filter_mode: _mi,
    mail_outbound_filter_mode: _mo,
    phone_inbound_filter_mode: _pi,
    phone_outbound_filter_mode: _po,
    ...older
  } = IDENTITY;
  const { exitCode, stdout } = await runCli(["identity", "get", HANDLE], older);

  assert.equal(exitCode, 0);
  const record = JSON.parse(stdout);
  assert.equal(record.mailOutboundFilterMode, "whitelist");
  assert.equal(record.phoneInboundFilterMode, "whitelist");
});

test("identity update sends only the directional flags supplied", async () => {
  const { exitCode, requests } = await runCli([
    "identity", "update", HANDLE,
    "--phone-inbound-filter-mode", "supervised",
    "--mail-outbound-filter-mode", "supervised",
  ]);

  assert.equal(exitCode, 0);
  const patch = requests.find((request) => request.method === "PATCH");
  assert.equal(patch.url, `/api/v1/identities/${HANDLE}`);
  assert.deepEqual(patch.body, {
    mail_outbound_filter_mode: "supervised",
    phone_inbound_filter_mode: "supervised",
  });
});

test("identity update still accepts the single-mode flags", async () => {
  const { exitCode, requests } = await runCli([
    "identity", "update", HANDLE, "--mail-filter-mode", "blacklist",
  ]);

  assert.equal(exitCode, 0);
  const patch = requests.find((request) => request.method === "PATCH");
  assert.deepEqual(patch.body, { mail_filter_mode: "blacklist" });
});

for (const [name, flags, message] of [
  [
    "supervised inbound mail",
    ["--mail-inbound-filter-mode", "supervised"],
    /--mail-inbound-filter-mode must be 'whitelist' or 'blacklist'/,
  ],
  [
    "an unknown directional mode",
    ["--phone-outbound-filter-mode", "open"],
    /--phone-outbound-filter-mode must be 'whitelist', 'blacklist', or 'supervised'/,
  ],
  [
    "a single mode with a directional mode of the same channel",
    ["--phone-filter-mode", "whitelist", "--phone-outbound-filter-mode", "supervised"],
    /cannot be combined/,
  ],
  [
    "the iMessage alias with a directional phone mode",
    ["--imessage-filter-mode", "whitelist", "--phone-inbound-filter-mode", "supervised"],
    /cannot be combined/,
  ],
]) {
  test(`identity update rejects ${name} before any request`, async () => {
    const { exitCode, stderr, requests } = await runCli(["identity", "update", HANDLE, ...flags]);

    assert.notEqual(exitCode, 0);
    assert.match(stderr, message);
    assert.equal(requests.length, 0);
  });
}
