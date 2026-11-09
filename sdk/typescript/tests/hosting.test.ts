import { expect, it, vi } from "vitest";
import { IdentitiesResource } from "../src/identities/resources/identities.js";
import type { HttpTransport } from "../src/_http.js";

it("encodes handles and preserves empty triggers, explicit credits and omitted choices", async () => {
  const wire = {mode:"inkbox",identity_id:"identity",state:"provisioning",generation:2,applied_generation:1};
  const http = {get:vi.fn().mockResolvedValue(wire),put:vi.fn().mockResolvedValue(wire)};
  const resource = new IdentitiesResource(http as unknown as HttpTransport);
  expect((await resource.getHosting("@agent/one")).appliedGeneration).toBe(1);
  expect(http.get).toHaveBeenCalledWith("/%40agent%2Fone/hosting");
  await resource.updateHosting("agent",{expectedGeneration:1,triggerEvents:[],credentialBindingId:null});
  expect(JSON.parse(JSON.stringify(http.put.mock.calls[0][1]))).toEqual({expected_generation:1,trigger_events:[],credential_binding_id:null});
  await resource.updateHosting("agent",{expectedGeneration:2,enabled:false});
  expect(JSON.parse(JSON.stringify(http.put.mock.calls[1][1]))).toEqual({expected_generation:2,enabled:false});
});

it("saves and reads the persistent hosting default model", async () => {
  const wire = {mode:"inkbox",identity_id:"identity",state:"ready",generation:2,applied_generation:2,default_model:"gpt-6-luna"};
  const http = {get:vi.fn().mockResolvedValue(wire),put:vi.fn().mockResolvedValue(wire)};
  const resource = new IdentitiesResource(http as unknown as HttpTransport);
  expect((await resource.getHosting("agent")).defaultModel).toBe("gpt-6-luna");
  expect((await resource.updateHosting("agent", {expectedGeneration:1,defaultModel:"gpt-6-luna"})).defaultModel).toBe("gpt-6-luna");
  expect(JSON.parse(JSON.stringify(http.put.mock.calls[0][1]))).toEqual({expected_generation:1,default_model:"gpt-6-luna"});
});


it("paginates delivery status and retries the same escaped delivery ID", async () => {
  const item = {id: "event", event: "message.received", state: "expired", attempts: 3,
    received_at: "2026-01-01T00:00:00Z", last_error: "unavailable", retryable: true};
  const http = {get: vi.fn().mockResolvedValue({items: [item]}), post: vi.fn().mockResolvedValue({queued: true})};
  const resource = new IdentitiesResource(http as unknown as HttpTransport);
  expect((await resource.listHostingDeliveries("@example", "cursor"))[0].receivedAt).toBe(item.received_at);
  expect(http.get).toHaveBeenCalledWith("/%40example/hosting/deliveries", {before: "cursor"});
  expect(await resource.retryHostingDelivery("@example", "id/path")).toBe(true);
  expect(http.post).toHaveBeenCalledWith("/%40example/hosting/deliveries/id%2Fpath/retry", {});
});

it("reads computer history and conversation cursors without lifecycle writes", async () => {
  const {ComputersResource} = await import("../src/computers.js");
  const http = {get: vi.fn().mockResolvedValue({items: [], status: "not_running"}), post: vi.fn()};
  const computers = new ComputersResource(http as unknown as HttpTransport);
  expect((await computers.usageHistory("machine/path", "7d")).items).toEqual([]);
  expect(http.get).toHaveBeenLastCalledWith("/computers/machines/machine%2Fpath/usage/history", {window: "7d"});
  expect((await computers.conversations("machine")).status).toBe("not_running");
  await computers.conversation("machine", "session/a", "42");
  expect(http.get).toHaveBeenLastCalledWith("/computers/machines/machine/conversations", {session_id: "session/a", before: "42"});
  await computers.sessionRuns("session/a");
  expect(http.get).toHaveBeenLastCalledWith("/computers/sessions/session%2Fa/runs");
  expect(http.post).not.toHaveBeenCalled();
});


it("preserves selected template defaults, legacy metadata, and unavailable harnesses", async () => {
  const {readFileSync} = await import("node:fs");
  const {ComputersResource} = await import("../src/computers.js");
  const wire = JSON.parse(readFileSync(new URL("../../../contracts/computer-templates.json", import.meta.url), "utf8"));
  const http = {get: vi.fn().mockResolvedValue(wire)};
  const result = await new ComputersResource(http as unknown as HttpTransport).templates();
  expect(http.get).toHaveBeenCalledExactlyOnceWith("/computers/templates");
  expect(result.hosted_defaults.codex?.id).toBe("codex-current");
  expect(result.hosted_defaults.codex?.total_disk_bytes).toBe(12000000000);
  expect(result.hosted_defaults.hermes).toBeNull();
  expect(result.items[0].software.os).toBeNull();
});
