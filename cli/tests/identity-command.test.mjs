import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const exec = promisify(execFile);

test("identity update rejects rename flags before HTTP and still updates profiles", async (t) => {
  const calls = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: request.method, path: request.url, body });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      id: "11111111-1111-1111-1111-111111111111",
      organization_id: "org_example",
      agent_handle: "sales-agent",
      display_name: body?.display_name ?? "Sales",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const env = { ...process.env, INKBOX_API_KEY: "test-key", INKBOX_BASE_URL: `http://127.0.0.1:${server.address().port}`, NODE_USE_ENV_PROXY: "0" };
  const run = (...args) => exec(process.execPath, [cli, "identity", "update", ...args], { env });

  const help = await run("--help");
  assert.doesNotMatch(help.stdout, /--new-handle/);
  assert.match(help.stdout, /--display-name/);
  await assert.rejects(run("sales-agent", "--new-handle", "other-agent"), /unknown option/);
  assert.deepEqual(calls, []);

  await run("sales-agent", "--display-name", "Sales assistant");
  assert.deepEqual(calls.map(({ method }) => method), ["GET", "PATCH"]);
  assert.equal(calls[1].path, "/api/v1/identities/sales-agent");
  assert.deepEqual(calls[1].body, { display_name: "Sales assistant" });
});
