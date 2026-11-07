import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
for (const channel of ["text", "imessage", "whatsapp"]) {
  test(`${channel} conversations forwards repeated participants and contacts`, async (t) => {
    const calls = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url, "http://localhost");
      calls.push(url);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(url.pathname.includes("/identities/") ? {
        id: "10000000-0000-0000-0000-000000000001", organization_id: "org_example", agent_handle: "support-bot",
        imessage_enabled: true, phone_number: { id: "20000000-0000-0000-0000-000000000001", number: "+14155550100", status: "active" },
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      } : []));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const run = (...args) => exec(process.execPath, [cli, "--base-url", `http://127.0.0.1:${server.address().port}`,
      "--api-key", "synthetic-test-key", "--json", channel, "conversations", "--identity", "support-bot", ...args],
      { env: { ...process.env, NODE_USE_ENV_PROXY: "0" }, timeout: 10000 });
    await run("--participants", "guest@example.com", "+14155550123", ...(channel === "whatsapp" ? [] : ["--include-groups"]));
    assert.deepEqual(calls.at(-1).searchParams.getAll("participants"), ["guest@example.com", "+14155550123"]);
    assert.equal(calls.at(-1).searchParams.get("include_groups"), channel === "whatsapp" ? null : "true");
    await run("--contact-id", "aaaaaaaa-1111-4111-8111-111111111111");
    assert.equal(calls.at(-1).searchParams.get("contact_id"), "aaaaaaaa-1111-4111-8111-111111111111");
    const before = calls.filter(url => url.pathname.endsWith("/conversations")).length;
    await assert.rejects(run("--participants", "+14155550123", "--contact-id", "aaaaaaaa-1111-4111-8111-111111111111"));
    assert.equal(calls.filter(url => url.pathname.endsWith("/conversations")).length, before);
  });
}
