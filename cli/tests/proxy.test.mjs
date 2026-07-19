import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

// A TCP listener standing in for a proxy: it records each connection and
// drops it, so the CLI fails fast without any real network traffic.
function listen() {
  return new Promise((resolve) => {
    const connections = [];
    const server = net.createServer((socket) => {
      connections.push(socket.remoteAddress);
      socket.destroy();
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, connections, port: server.address().port });
    });
  });
}

function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env: { ...process.env, ...env }, timeout: 15_000 },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }),
    );
  });
}

test("routes requests through HTTPS_PROXY when set", async () => {
  const proxy = await listen();
  try {
    const { code } = await runCli(
      ["whoami", "--base-url", "https://api.invalid/api/v1"],
      {
        INKBOX_API_KEY: "test-key",
        HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
        NODE_USE_ENV_PROXY: "",
      },
    );

    assert.equal(code, 1);
    // The connection reached our fake proxy instead of being dialed direct
    // (api.invalid would otherwise fail on DNS without touching the proxy).
    assert.ok(proxy.connections.length > 0);
  } finally {
    proxy.server.close();
  }
});

test("still proxies when NODE_USE_ENV_PROXY is already set", async () => {
  // NODE_USE_ENV_PROXY only exists on Node 22.21+/24+, so the CLI must not
  // treat "the flag is set" as "Node has it covered" on older runtimes.
  const proxy = await listen();
  try {
    const { code } = await runCli(
      ["whoami", "--base-url", "https://api.invalid/api/v1"],
      {
        INKBOX_API_KEY: "test-key",
        HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
        NODE_USE_ENV_PROXY: "1",
      },
    );

    assert.equal(code, 1);
    assert.ok(proxy.connections.length > 0);
  } finally {
    proxy.server.close();
  }
});

test("NODE_USE_ENV_PROXY=0 opts out of proxying", async () => {
  const proxy = await listen();
  try {
    const { code } = await runCli(
      ["whoami", "--base-url", "https://api.invalid/api/v1"],
      {
        INKBOX_API_KEY: "test-key",
        HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
        NODE_USE_ENV_PROXY: "0",
      },
    );

    // Direct dial: DNS on api.invalid fails without touching the proxy.
    assert.equal(code, 1);
    assert.equal(proxy.connections.length, 0);
  } finally {
    proxy.server.close();
  }
});
