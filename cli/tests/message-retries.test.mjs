import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const id = "10000000-0000-0000-0000-000000000001";
const run = (port, args) => new Promise((resolve, reject) => execFile(process.execPath,
  [cli, "--base-url", `http://127.0.0.1:${port}`, "--api-key", "test-only", "--json", ...args],
  { env: { ...process.env, NODE_USE_ENV_PROXY: "0" }, timeout: 10000 },
  (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(JSON.parse(stdout))));

test("send-lookup carries the key only in a header and performs no send", async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, key: request.headers["idempotency-key"] });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ message_id: id }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    assert.deepEqual(await run(server.address().port, ["send-lookup", "--sender-kind", "phone_number", "--sender-id", id,
      "--operation", "text.send", "--idempotency-key", "original-key"]), { messageId: id });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].key, "original-key");
    assert(!requests[0].url.includes("original-key"));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("imessage get resolves its identity and reads one message", async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(request.url.includes("/imessage/messages/")
      ? { id, conversation_id: id, assignment_id: null, direction: "outbound", content: "Hello",
        message_type: "message", service: "imessage", status: "pending", is_read: false,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }
      : { id, organization_id: "org_example", agent_handle: "example", imessage_enabled: true,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await run(server.address().port, ["imessage", "get", id, "--identity", "example"]);
    assert.equal(result.id, id);
    assert.equal(result.status, "pending");
    assert(requests.every(request => request.method === "GET"));
    assert.equal(requests[1].url, `/api/v1/imessage/messages/${id}?agent_identity_id=${id}`);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

for (const disconnect of ["before headers", "during response body"]) {
  test(`text send preserves its generated key after a disconnect ${disconnect}`, async () => {
    const sends = [];
    const server = http.createServer((request, response) => {
      response.setHeader("Content-Type", "application/json");
      if (request.method === "GET") {
        response.end(JSON.stringify({ id, organization_id: "org_example", agent_handle: "example",
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", mailbox: null,
          phone_number: { id, number: "+15555550100", type: "local", status: "active" } }));
        return;
      }
      let body = "";
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        sends.push({ body, key: request.headers["idempotency-key"], prefer: request.headers.prefer });
        if (sends.length === 1) {
          if (disconnect === "during response body") {
            response.writeHead(201);
            response.flushHeaders();
            response.write('{"id":');
            setTimeout(() => response.destroy(), 25);
          } else {
            response.destroy();
          }
          return;
        }
        response.statusCode = 201;
        response.end(JSON.stringify({ id, direction: "outbound", text: "Hello", type: "sms",
          local_phone_number: "+15555550100", remote_phone_number: "+15555550123",
          delivery_status: "queued", created_at: "2026-01-01T00:00:00Z" }));
      });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const result = await run(server.address().port, ["text", "send", "--identity", "example", "--to", "+15555550123", "--text", "Hello"]);
      assert.equal(result.id, id);
      assert.equal(sends.length, 2);
      assert.deepEqual(sends[0], sends[1]);
      assert.match(sends[0].key, /^[0-9a-f-]{36}$/);
      assert.equal(sends[0].prefer, "idempotency-replay");
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
}
