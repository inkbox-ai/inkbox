import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Inkbox } from "../../src/inkbox.js";
import { InkboxAPIError } from "../../src/_http.js";
import { connect } from "../../src/tunnels/client/index.js";
import { loadState, saveState } from "../../src/tunnels/client/_state.js";
import { TunnelStateConflict } from "../../src/tunnels/exceptions.js";

vi.mock("../../src/tunnels/client/_runtime.js", () => ({
  TunnelRuntime: class {}, DEFAULT_INBOUND_BODY_BYTES: 100, DEFAULT_RESPONSE_BYTES: 100,
  DEFAULT_OUTBOUND_BODY_BYTES: 100,
}));
vi.mock("../../src/tunnels/client/_listener.js", () => ({
  TunnelListenerImpl: class { constructor(public options: unknown) {} },
}));

let stateDir: string;
beforeEach(() => { stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkbox-bootstrap-")); });
afterEach(() => { fs.rmSync(stateDir, { recursive: true, force: true }); });
const record = (name: string, id: string) => ({
  id, tunnelName: name, tlsMode: "edge", status: "active",
  publicHost: `${name}.example.test`, zone: "example.test",
});
const run = (tunnels: unknown) => connect({ tunnels } as Inkbox, {
  name: "my-agent", stateDir, forwardTo: "http://127.0.0.1:8080", installSignalHandlers: false,
});

it.each(["another-agent", "my-agent"])("checks both saved name %s and fetched name", async (name) => {
  saveState(stateDir, { name, tunnelId: "old-id" });
  const api = {
    get: vi.fn().mockResolvedValue(record("another-agent", "old-id")),
    list: vi.fn().mockResolvedValue([record("my-agent", "wanted-id")]),
  };
  await run(api);
  expect(loadState(stateDir)?.tunnelId).toBe("wanted-id");
  if (name !== "my-agent") expect(api.get).not.toHaveBeenCalled();
});

it("rediscovers the requested name after a removed saved ID without deleting keys", async () => {
  saveState(stateDir, { name: "my-agent", tunnelId: "old-id" });
  fs.writeFileSync(path.join(stateDir, "private_key.pem"), "preserve");
  await run({
    get: vi.fn().mockRejectedValue(new InkboxAPIError(404, "not found")),
    list: vi.fn().mockResolvedValue([record("my-agent", "new-id")]),
  });
  expect(loadState(stateDir)?.tunnelId).toBe("new-id");
  expect(fs.readFileSync(path.join(stateDir, "private_key.pem"), "utf8")).toBe("preserve");
});

it.each(["edge", "passthrough"])("does not connect or sign for a deleted %s tunnel", async (tlsMode) => {
  const api = {
    list: vi.fn().mockResolvedValue([{ ...record("my-agent", "old-id"), tlsMode, status: "deleted" }]),
    signCsr: vi.fn(),
  };
  await expect(run(api)).rejects.toBeInstanceOf(TunnelStateConflict);
  expect(api.signCsr).not.toHaveBeenCalled();
});
