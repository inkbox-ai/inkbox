import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const execFileAsync = promisify(execFile);

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
  assert.match(text, /messages/);
  assert.match(text, /contexts/);
  assert.match(text, /context (?:\[options\] )?<context-id>/);
  assert.match(text, /sent-contexts/);
  assert.match(text, /sent-context (?:\[options\] )?<context-id>/);
  assert.match(text, /rename-context/);
  assert.match(text, /filter-mode/);
});

test("A2A call explains new-task context reuse", () => {
  assert.match(
    help("a2a", "call"),
    /Start a new task in an existing context when --task\s+is absent/,
  );
});

test("A2A context commands expose history and rename options", () => {
  const contexts = help("a2a", "contexts");
  assert.match(contexts, /--direction <direction>/);
  assert.match(contexts, /--cursor <cursor>/);
  assert.match(contexts, /--limit <n>/);
  assert.match(help("a2a", "sent-contexts"), /--cursor <cursor>/);
  assert.match(help("a2a", "context"), /--identity <handle>/);
  assert.match(help("a2a", "sent-context"), /--identity <handle>/);
  assert.match(help("a2a", "rename-context"), /--name <name>/);
});

for (const command of ["tasks", "sent"]) {
  test(`A2A ${command} history exposes peer, search, and pagination filters`, () => {
    const text = help("a2a", command);
    assert.match(text, /--identity <handle>/);
    assert.match(text, /--requester <handle>/);
    assert.match(text, /--worker <handle>/);
    assert.match(text, /--state <state>/);
    assert.match(text, /--context <id>/);
    assert.match(text, /--query <query>/);
    assert.match(text, /--since <datetime>/);
    assert.match(text, /--cursor <cursor>/);
    assert.match(text, /--limit <n>/);
  });
}

test("A2A unified task history exposes direction", () => {
  assert.match(help("a2a", "tasks"), /--direction <direction>/);
});

test("A2A worker replies expose progress updates", () => {
  assert.match(help("a2a", "reply"), /--progress/);
});

test("A2A message history exposes provenance, search, and pagination filters", () => {
  const text = help("a2a", "messages");
  for (const pattern of [
    /--identity <handle>/,
    /--direction <direction>/,
    /--requester <handle>/,
    /--worker <handle>/,
    /--task <id>/,
    /--context <id>/,
    /--role <role>/,
    /--query <query>/,
    /--since <datetime>/,
    /--cursor <cursor>/,
    /--limit <n>/,
  ]) {
    assert.match(text, pattern);
  }
});

test("A2A admission controls expose complete admin operations", () => {
  assert.match(help("a2a", "filter-mode"), /--mode <mode>/);
  assert.match(help("a2a", "skills", "reset"), /--identity <handle>/);
  assert.match(help("a2a", "rules", "add"), /--direction <direction>/);
  assert.match(help("a2a", "rules", "update"), /--action <action>/);
  assert.match(help("a2a", "rules", "update"), /--direction <direction>/);
  assert.match(help("a2a", "rules", "delete"), /--identity <handle>/);
});

test("A2A context commands use canonical SDK routes and preserve names", async (t) => {
  const context = {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Quarterly Research",
    caller: {
      identity_id: "11111111-1111-1111-1111-111111111111",
      organization_id: "org-a",
      handle: "coordinator",
      trust_tier: "inkbox_verified",
    },
    target: {
      identity_id: "33333333-3333-3333-3333-333333333333",
      organization_id: "org-b",
      handle: "researcher",
    },
    tasks: [],
    tasks_truncated: false,
    created_at: "2026-08-01T00:00:00Z",
    last_activity_at: "2026-08-01T00:01:00Z",
  };
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, body });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/whoami") {
      response.end(JSON.stringify({
        auth_type: "api_key",
        auth_subtype: "api_key.agent_scoped.claimed",
        scope: "agent_identity:11111111-1111-1111-1111-111111111111",
        organization_id: "org-a",
        created_by: null,
        creator_type: null,
        key_id: null,
        label: null,
        description: null,
        created_at: null,
        last_used_at: null,
        expires_at: null,
      }));
      return;
    }
    if (request.url === "/card") {
      response.end(JSON.stringify({
        name: "Researcher",
        supportedInterfaces: [{
          url: `http://${request.headers.host}/rpc`,
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        }],
      }));
      return;
    }
    if (request.url === "/rpc") {
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: JSON.parse(body).id,
        result: {
          task: {
            id: "44444444-4444-4444-4444-444444444444",
            contextId: context.id,
            status: { state: "TASK_STATE_SUBMITTED" },
          },
        },
      }));
      return;
    }
    if (request.url === "/api/v1/identities/coordinator") {
      response.end(JSON.stringify({
        id: "11111111-1111-1111-1111-111111111111",
        organization_id: "org-a",
        agent_handle: "coordinator",
        display_name: "Coordinator",
        description: null,
        email_address: "coordinator@example.test",
        imessage_enabled: false,
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
        mailbox: null,
        phone_number: null,
        imessage_number: null,
        tunnel: null,
        access: [],
      }));
      return;
    }
    if (request.method === "PATCH") {
      const renamed = { ...context, name: JSON.parse(body).name };
      response.end(JSON.stringify(renamed));
      return;
    }
    if (
      request.url?.startsWith("/api/v1/identities/coordinator/a2a/contexts?")
      || request.url?.startsWith("/api/v1/identities/coordinator/a2a/sent/contexts?")
    ) {
      response.end(JSON.stringify({ items: [context], next_cursor: null }));
      return;
    }
    response.end(JSON.stringify(context));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");
  const env = {
    ...process.env,
    INKBOX_API_KEY: "ApiKey_test",
    INKBOX_BASE_URL: `http://127.0.0.1:${address.port}`,
    NODE_USE_ENV_PROXY: "0",
  };
  const run = (...args) => execFileAsync(process.execPath, [cli, ...args], { env });

  const table = await run("a2a", "contexts", "-i", "coordinator", "--direction", "both");
  assert.match(table.stdout, /Quarterly Research/);
  assert.match(table.stdout, /researcher/);
  assert.match(table.stdout, /outbound/);

  const listed = await run("--json", "a2a", "sent-contexts", "-i", "coordinator");
  assert.equal(JSON.parse(listed.stdout).items[0].name, "Quarterly Research");

  const received = await run("--json", "a2a", "context", context.id, "-i", "coordinator");
  assert.equal(JSON.parse(received.stdout).name, "Quarterly Research");

  const sent = await run("--json", "a2a", "sent-context", context.id, "-i", "coordinator");
  assert.equal(JSON.parse(sent.stdout).name, "Quarterly Research");

  const renamed = await run(
    "--json",
    "a2a",
    "rename-context",
    context.id,
    "-i",
    "coordinator",
    "--name",
    "Analyse Überprüfung Ergebnis Jetzt",
  );
  assert.equal(
    JSON.parse(renamed.stdout).name,
    "Analyse Überprüfung Ergebnis Jetzt",
  );

  await run(
    "--json",
    "a2a",
    "call",
    `http://127.0.0.1:${address.port}/card`,
    "-i",
    "coordinator",
    "--text",
    "Review the findings",
    "--context",
    context.id,
    "--message-id",
    "protocol-message-1",
  );

  const a2aRequests = requests.filter(({ url }) => url.includes("/a2a/"));
  assert(a2aRequests.some(({ method, url }) =>
    method === "GET" && url.startsWith("/api/v1/identities/coordinator/a2a/contexts?")));
  assert(a2aRequests.some(({ method, url }) =>
    method === "GET" && url.startsWith("/api/v1/identities/coordinator/a2a/sent/contexts?")));
  assert(a2aRequests.some(({ method, url }) =>
    method === "GET" && url === `/api/v1/identities/coordinator/a2a/contexts/${context.id}`));
  assert(a2aRequests.some(({ method, url }) =>
    method === "GET" && url === `/api/v1/identities/coordinator/a2a/sent/contexts/${context.id}`));
  assert.deepEqual(
    JSON.parse(a2aRequests.find(({ method }) => method === "PATCH").body),
    { name: "Analyse Überprüfung Ergebnis Jetzt" },
  );
  const rpcBody = JSON.parse(requests.find(({ url }) => url === "/rpc").body);
  assert.deepEqual(rpcBody.params.message, {
    messageId: "protocol-message-1",
    role: "ROLE_USER",
    parts: [{ text: "Review the findings" }],
    contextId: context.id,
  });
});
