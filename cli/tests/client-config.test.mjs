import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { createClient, resolveBaseUrl } from "../dist/client.js";

const VARS = ["HOME", "INKBOX_API_KEY", "INKBOX_BASE_URL", "INKBOX_VAULT_KEY"];

// Point HOME at a temp dir holding ~/.inkbox/config, apply env overrides,
// run fn, then restore the original environment. createClient() calls
// process.exit(1) when no API key resolves; turn that into a thrown error.
function withConfig(configText, env, fn) {
  const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  const origExit = process.exit;
  const origError = console.error;
  process.exit = (code) => {
    throw new Error(`process.exit(${code})`);
  };
  console.error = () => {};
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "inkbox-cli-config-"));
  fs.mkdirSync(path.join(home, ".inkbox"));
  fs.writeFileSync(path.join(home, ".inkbox", "config"), configText);
  try {
    for (const k of VARS) delete process.env[k];
    Object.assign(process.env, { HOME: home, ...env });
    return fn();
  } finally {
    process.exit = origExit;
    console.error = origError;
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const CONFIG = "api_key = file-key\nbase_url = https://file.example.com\n";

test("empty INKBOX_API_KEY / INKBOX_BASE_URL fall back to ~/.inkbox/config", () => {
  withConfig(CONFIG, { INKBOX_API_KEY: "", INKBOX_BASE_URL: "" }, () => {
    const client = createClient({});
    assert.equal(client._apiKey, "file-key");
    assert.equal(client._baseUrl, "https://file.example.com");
    assert.equal(resolveBaseUrl({}), "https://file.example.com");
  });
});

test("non-empty env vars still take precedence over ~/.inkbox/config", () => {
  withConfig(
    CONFIG,
    { INKBOX_API_KEY: "env-key", INKBOX_BASE_URL: "https://env.example.com" },
    () => {
      const client = createClient({});
      assert.equal(client._apiKey, "env-key");
      assert.equal(client._baseUrl, "https://env.example.com");
      assert.equal(resolveBaseUrl({}), "https://env.example.com");
    },
  );
});

test("flags take precedence over env vars", () => {
  withConfig(CONFIG, { INKBOX_API_KEY: "env-key" }, () => {
    const client = createClient({ apiKey: "flag-key", baseUrl: "https://flag.example.com" });
    assert.equal(client._apiKey, "flag-key");
    assert.equal(client._baseUrl, "https://flag.example.com");
  });
});
