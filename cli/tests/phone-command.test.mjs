import assert from "node:assert/strict";
import test from "node:test";
import { execFile, execFileSync } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { buildPlaceCallOptions } from "../dist/commands/phone.js";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function help(...args) {
  return execFileSync(process.execPath, [cli, ...args, "--help"], {
    encoding: "utf8",
  });
}

function runCli(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, ...args],
      {
        env: {
          ...process.env,
          NODE_USE_ENV_PROXY: "0",
        },
        timeout: 15_000,
      },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    );
  });
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

const IDENTITY = {
  id: "eeee5555-0000-0000-0000-000000000001",
  organization_id: "org_test",
  agent_handle: "support-bot",
  display_name: "Support Bot",
  description: null,
  email_address: null,
  created_at: "2026-07-29T00:00:00Z",
  updated_at: "2026-07-29T00:00:00Z",
  mailbox: null,
  phone_number: {
    id: "11111111-1111-1111-1111-111111111111",
    number: "+15550000001",
    type: "local",
    status: "active",
    sms_status: "ready",
    sms_error_code: null,
    sms_error_detail: null,
    sms_ready_at: "2026-07-29T00:00:00Z",
    incoming_call_action: "auto_reject",
    client_websocket_url: null,
    incoming_call_webhook_url: null,
    state: null,
    agent_identity_id: "eeee5555-0000-0000-0000-000000000001",
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
  },
  tunnel: null,
};

test("phone help exposes authority controls", () => {
  assert.match(help("phone", "call"), /--authority-mode <mode>/);
  assert.match(help("phone", "call"), /--no-voicemail-detection/);
  assert.match(help("phone", "call"), /dedicated_imessage_number/);
  assert.match(help("phone", "tool-activity"), /--limit <n>/);
  assert.match(help("phone", "tool-activity"), /--offset <n>/);
  const authorityHelp = help("phone", "hosted-agent", "authority-mode");
  assert.match(authorityHelp, /admin API key/);
});

test("buildPlaceCallOptions disables voicemail detection only when requested", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    voicemailDetection: false,
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      voicemailDetection: "disabled",
    },
  });
});

test("buildPlaceCallOptions builds a plain client-driven call", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
  });

  // No mode key: the SDK defaults it to client_websocket on the wire.
  assert.deepEqual(result, {
    callOptions: { toNumber: "+15551234567" },
  });
});

test("buildPlaceCallOptions forwards the ws url and origination on client-driven calls", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    wsUrl: "wss://agent.example.com/ws",
    origination: "shared_imessage_number",
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      clientWebsocketUrl: "wss://agent.example.com/ws",
      origination: "shared_imessage_number",
    },
  });
});

test("buildPlaceCallOptions forwards shared iMessage origination", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    origination: "shared_imessage_number",
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      origination: "shared_imessage_number",
    },
  });
});

test("buildPlaceCallOptions forwards explicit dedicated origination", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    origination: "dedicated_number",
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      origination: "dedicated_number",
    },
  });
});

test("buildPlaceCallOptions forwards dedicated iMessage origination", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    origination: "dedicated_imessage_number",
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      origination: "dedicated_imessage_number",
    },
  });
});

test("buildPlaceCallOptions rejects an unknown origination", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    origination: "unknown_line",
  });

  assert.deepEqual(result, {
    error:
      "--origination must be dedicated_number, shared_imessage_number, "
      + "or dedicated_imessage_number.",
  });
});

test("buildPlaceCallOptions builds a shared hosted call with mode and reason", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    hosted: true,
    reason: "Book a cleaning next week, mornings preferred",
    origination: "shared_imessage_number",
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      mode: "hosted_agent",
      reason: "Book a cleaning next week, mornings preferred",
      origination: "shared_imessage_number",
    },
  });
});

test("buildPlaceCallOptions forwards yolo authority on a hosted call", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    hosted: true,
    reason: "Coordinate the appointment",
    authorityMode: "yolo",
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      mode: "hosted_agent",
      reason: "Coordinate the appointment",
      hostedAgentAuthorityMode: "yolo",
    },
  });
});

test("buildPlaceCallOptions rejects authority without --hosted", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    authorityMode: "yolo",
  });

  assert.deepEqual(result, {
    error: "--authority-mode requires --hosted.",
  });

  assert.deepEqual(buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    authorityMode: "contact_scoped",
  }), {
    error: "--authority-mode requires --hosted.",
  });
});

test("buildPlaceCallOptions rejects an unknown authority mode", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    authorityMode: "global",
  });

  assert.deepEqual(result, {
    error: "--authority-mode must be contact_scoped or yolo.",
  });
});

test("buildPlaceCallOptions rejects --hosted without --reason", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    hosted: true,
  });

  assert.deepEqual(result, {
    error: "--hosted requires --reason (the agent's task brief).",
  });
});

test("buildPlaceCallOptions rejects --hosted with --ws-url", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    hosted: true,
    reason: "Confirm the appointment",
    wsUrl: "wss://agent.example.com/ws",
  });

  assert.deepEqual(result, {
    error: "--hosted conflicts with --ws-url (Voice AI calls need no socket).",
  });
});

test("buildPlaceCallOptions rejects --reason without --hosted", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    reason: "Confirm the appointment",
  });

  assert.deepEqual(result, {
    error: "--reason is only valid with --hosted.",
  });
});

test("phone call forwards voicemail opt-out and prints the persisted value", async () => {
  const requests = [];
  const mock = await listen((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        body: body ? JSON.parse(body) : null,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/api/v1/identities/support-bot") {
        res.end(JSON.stringify(IDENTITY));
        return;
      }
      res.end(JSON.stringify({
        id: "22222222-2222-2222-2222-222222222222",
        local_phone_number: "+15550000001",
        remote_phone_number: "+15551234567",
        direction: "outbound",
        status: "initiated",
        client_websocket_url: "wss://agent.example.com/audio",
        use_inkbox_tts: null,
        use_inkbox_stt: null,
        hangup_reason: null,
        started_at: null,
        ended_at: null,
        is_blocked: false,
        origin: "dedicated_number",
        mode: "client_websocket",
        hosted_agent_authority_mode: "contact_scoped",
        voicemail_detection: "disabled",
        reason: null,
        post_call_action_items: [],
        created_at: "2026-07-29T00:00:00Z",
        updated_at: "2026-07-29T00:00:00Z",
        rate_limit: {
          calls_used: 1,
          calls_remaining: 99,
          calls_limit: 100,
          minutes_used: 0,
          minutes_remaining: 1000,
          minutes_limit: 1000,
        },
      }));
    });
  });

  try {
    const result = await runCli([
      "--api-key", "test-key",
      "--base-url", `http://127.0.0.1:${mock.port}`,
      "--json",
      "phone", "call",
      "-i", "support-bot",
      "--to", "+15551234567",
      "--ws-url", "wss://agent.example.com/audio",
      "--no-voicemail-detection",
    ]);

    assert.ifError(result.error);
    assert.equal(result.stderr, "");
    assert.deepEqual(requests, [
      {
        method: "GET",
        url: "/api/v1/identities/support-bot",
        body: null,
      },
      {
        method: "POST",
        url: "/api/v1/phone/place-call",
        body: {
          from_number: "+15550000001",
          to_number: "+15551234567",
          client_websocket_url: "wss://agent.example.com/audio",
          mode: "client_websocket",
          origination: "dedicated_number",
          voicemail_detection: "disabled",
        },
      },
    ]);
    assert.equal(JSON.parse(result.stdout).voicemailDetection, "disabled");
  } finally {
    mock.server.close();
  }
});

test("tool-activity calls the paginated SDK surface and prints the page", async () => {
  const requests = [];
  const mock = await listen((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/api/v1/identities/support-bot") {
      res.end(JSON.stringify(IDENTITY));
      return;
    }
    res.end(JSON.stringify({
      items: [{
        id: "11111111-1111-1111-1111-111111111111",
        call_id: "22222222-2222-2222-2222-222222222222",
        tool_name: "send_email",
        status: "succeeded",
        result: { state: "sent" },
        started_at: "2026-07-29T00:00:00Z",
        completed_at: "2026-07-29T00:00:01Z",
      }],
      limit: 2,
      offset: 3,
      has_more: false,
    }));
  });

  try {
    const result = await runCli([
      "--api-key", "test-key",
      "--base-url", `http://127.0.0.1:${mock.port}`,
      "--json",
      "phone", "tool-activity", "22222222-2222-2222-2222-222222222222",
      "-i", "support-bot",
      "--limit", "2",
      "--offset", "3",
    ]);

    assert.ifError(result.error);
    assert.equal(result.stderr, "");
    assert.deepEqual(requests, [
      { method: "GET", url: "/api/v1/identities/support-bot" },
      {
        method: "GET",
        url:
          "/api/v1/phone/calls/22222222-2222-2222-2222-222222222222/tool-invocations"
          + "?limit=2&offset=3",
      },
    ]);
    const page = JSON.parse(result.stdout);
    assert.equal(page.items[0].toolName, "send_email");
    assert.equal(page.limit, 2);
    assert.equal(page.offset, 3);
  } finally {
    mock.server.close();
  }
});

test("authority-mode calls the privileged SDK setter", async () => {
  const requests = [];
  const mock = await listen((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        body: body ? JSON.parse(body) : null,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/api/v1/identities/support-bot") {
        res.end(JSON.stringify(IDENTITY));
        return;
      }
      res.end(JSON.stringify({
        agent_identity_id: IDENTITY.id,
        voice: null,
        model: null,
        effective_voice: "voice-default",
        effective_model: "model-default",
        instructions: null,
        authority_mode: "yolo",
      }));
    });
  });

  try {
    const result = await runCli([
      "--api-key", "test-key",
      "--base-url", `http://127.0.0.1:${mock.port}`,
      "--json",
      "phone", "hosted-agent", "authority-mode", "yolo",
      "-i", "support-bot",
    ]);

    assert.ifError(result.error);
    assert.equal(result.stderr, "");
    assert.deepEqual(requests, [
      {
        method: "GET",
        url: "/api/v1/identities/support-bot",
        body: null,
      },
      {
        method: "PUT",
        url: "/api/v1/phone/hosted-agent-config/authority-mode",
        body: {
          agent_identity_id: IDENTITY.id,
          authority_mode: "yolo",
        },
      },
    ]);
    assert.equal(JSON.parse(result.stdout).authorityMode, "yolo");
  } finally {
    mock.server.close();
  }
});
