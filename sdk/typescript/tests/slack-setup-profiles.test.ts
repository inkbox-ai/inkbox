import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { Inkbox, type SlackActorProfile, type SlackWebhookPayload } from "../src/index.js";
import { parseContact } from "../src/contacts/types.js";
const data = JSON.parse(readFileSync(new URL("../../../tests/fixtures/slack_setup_profiles.json", import.meta.url), "utf8"));
afterEach(() => vi.unstubAllGlobals());
it("starts setup once and parses nested dates while tolerating legacy responses", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  const client = new Inkbox({ apiKey: "synthetic-test-key", baseUrl: "https://example.com" });
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(data.setup), { status: 202 }));
  const setup = await client.slack.startSetup(data.identity_id, data.provisioning_workspace_id);
  expect(setup).toEqual({ status: "pending", retryAt: new Date(data.setup.retry_at), errorCode: null, provisioningWorkspaceId: data.provisioning_workspace_id });
  expect(new URL(String(fetch.mock.calls[0][0])).pathname).toBe("/api/v1/slack/applications/setup");
  expect(fetch.mock.calls[0][1]?.method).toBe("POST");
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ identity_id: data.identity_id, provisioning_workspace_id: data.provisioning_workspace_id });
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ connections: [], installation_available: true, setup: data.setup, application_created: true })));
  const current = await client.slack.listConnections(data.identity_id);
  expect(current.setup).toEqual(setup);
  expect(current.applicationCreated).toBe(true);
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ connections: [], installation_available: true })));
  const old = await client.slack.listConnections(data.identity_id);
  expect(old.setup).toBeNull();
  expect(old.applicationCreated).toBe(false);
});
it("parses linked Slack accounts without changing existing contact identifiers", () => {
  expect(parseContact(data.contact).slackAccounts).toEqual([
    { workspaceId: "TEXAMPLE", userId: "UEXAMPLE", workspaceName: "Example workspace" },
    { workspaceId: "TSECOND", userId: "USECOND", workspaceName: null },
  ]);
  expect(parseContact({ ...data.contact, slack_accounts: undefined }).slackAccounts).toEqual([]);
});
it("keeps sender enrichment optional and in the webhook's wire shape", () => {
  const minimal: SlackActorProfile = { id: "UEXAMPLE" };
  const payload: SlackWebhookPayload = data.webhook;
  expect(minimal.id).toBe(payload.data.actor_id);
  expect(payload.data.actor_profile?.profile?.email).toBe("person@example.com");
  expect(payload.data.actor_profile?.is_bot).toBe(false);
  expect(payload.data.actor_profile?.tz_offset).toBe(0);
  expect(payload.data.contact_id).toBe(data.contact.id);
});

it("reports missing credentials with no selected workspace", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    connections: [], installation_available: false,
    setup: { status: "needs_credentials", error_code: "credentials_required", provisioning_workspace_id: null },
    provisioning_workspace: null,
  }))));
  const result = await new Inkbox({ apiKey: "synthetic-test-key", baseUrl: "https://example.com" }).slack.listConnections(data.identity_id);
  expect(result.setup).toMatchObject({ status: "needs_credentials", errorCode: "credentials_required", provisioningWorkspaceId: null });
  expect(result.provisioningWorkspace).toBeNull();
});
