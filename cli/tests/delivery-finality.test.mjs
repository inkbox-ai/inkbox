import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const id = "10000000-0000-0000-0000-000000000001";
const timestamp = "2026-01-01T00:00:00Z";

test("CLI exposes finality, transport, and outbound summaries without polling or resending", async (t) => {
  const calls = [];
  const message = { id, conversation_id: id, assignment_id: null, direction: "outbound",
    remote_number: "+15551234567", message_type: "message", service: "sms", status: "sent",
    delivery_final: false, error_code: null, error_detail: null, content: "Hello",
    is_read: false, created_at: timestamp, updated_at: timestamp };
  const text = { id, conversation_id: id, direction: "outbound", local_phone_number: "+15557654321",
    remote_phone_number: "+15551234567", type: "sms", text: "Hello", media: null,
    delivery_status: "sent", delivery_final: false, is_read: false,
    created_at: timestamp, updated_at: timestamp };
  const summary = { id, assignment_id: null, latest_direction: "inbound", latest_type: "sms",
    latest_message_at: timestamp, latest_text: "Reply", total_count: 2, unread_count: 1,
    latest_outbound_service: "sms", latest_outbound_status: "sent", latest_outbound_delivery_final: false };
  const server = createServer((request, response) => {
    calls.push({ method: request.method, path: new URL(request.url, "http://localhost").pathname });
    const path = calls.at(-1).path;
    response.setHeader("content-type", "application/json");
    if (path === "/api/v1/identities/support-bot") {
      response.end(JSON.stringify({ id, organization_id: "org_example", agent_handle: "support-bot",
        imessage_enabled: true, phone_number: { id, number: "+15557654321", type: "local", status: "active",
          sms_status: "ready", incoming_call_action: "auto_reject", filter_mode: "whitelist",
          created_at: timestamp, updated_at: timestamp }, created_at: timestamp, updated_at: timestamp }));
    } else if (path.endsWith("/conversations")) {
      response.end(JSON.stringify([summary]));
    } else {
      const row = path.includes("/imessage/") ? message : text;
      const sent = path.includes("/imessage/") ? { message: row } : row;
      response.end(JSON.stringify(request.method === "POST" ? sent : [row]));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const run = (args, json = false) => exec(process.execPath, [cli, "--base-url", `http://127.0.0.1:${server.address().port}`,
    "--api-key", "test-only", ...(json ? ["--json"] : []), ...args, "--identity", "support-bot"],
  { env: { ...process.env, NODE_USE_ENV_PROXY: "0" }, timeout: 10000 });

  for (const channel of ["imessage", "text"]) {
    const start = calls.length;
    const sent = JSON.parse((await run([channel, "send", "--to", "+15551234567", "--text", "Hello"], true)).stdout);
    assert.equal(sent.deliveryFinal, false);
    assert.equal(sent[channel === "imessage" ? "service" : "type"], "sms");
    assert.equal(sent[channel === "imessage" ? "status" : "deliveryStatus"], "sent");
    assert.equal(calls.slice(start).filter(call => call.method === "POST").length, 1);
    assert.equal(calls.slice(start).length, 2, "one identity read and one send, no poll");
    for (const args of [[channel, "list"], [channel, "conversation", id]]) {
      const output = (await run(args)).stdout;
      assert.match(output, /deliveryFinal/);
      assert.match(output, /false/);
      assert.match(output, /sent/);
    }
    const output = (await run([channel, "conversations"])).stdout;
    assert.match(output, /latestOutboundService/);
    assert.match(output, /latestOutboundStatus/);
    assert.match(output, /latestOutboundDeliveryFinal/);
    assert.match(output, /inbound/);
    assert.match(output, /false/);
    const rows = JSON.parse((await run([channel, "conversations"], true)).stdout);
    assert.equal(rows[0].latestOutboundDeliveryFinal, false);
  }
});
