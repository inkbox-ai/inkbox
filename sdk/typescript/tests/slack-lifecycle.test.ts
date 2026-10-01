import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { Inkbox } from "../src/index.js";

const f = JSON.parse(readFileSync(new URL("../../../tests/fixtures/slack_lifecycle.json", import.meta.url), "utf8"));
const identity = f.deletion.identity_id;
afterEach(() => vi.unstubAllGlobals());

it("keeps asynchronous deletion honest and preserves retained-history filters and provenance", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  const reply = (data: unknown) => fetch.mockResolvedValueOnce(new Response(JSON.stringify(data)));
  const client = new Inkbox({ apiKey: "synthetic-test-key", baseUrl: "https://example.com" });
  reply(f.application_state);
  const state = await client.slack.getApplication(identity);
  expect(state.application?.status).toBe("deleting");
  expect(state.deletion?.status).toBe("pending");
  expect(state.deletion?.retryAt).toBeInstanceOf(Date);
  reply({ application: null, deletion: { ...f.deletion, app_id: null, status: "manually_confirmed" } });
  const manual = (await client.slack.getApplication(identity)).deletion;
  expect(manual?.status).toBe("manually_confirmed");
  expect(manual?.appId).toBeNull();
  reply(f.workspaces);
  const workspace = (await client.slack.listHistoryWorkspaces(identity))[0];
  expect(workspace.liveConnectionId).toBeNull();
  expect(workspace.reconnectConnectionId).toBeTruthy();
  reply(f.history);
  const history = await client.slack.listHistoryMessages(identity, { workspaceId: "TEXAMPLE", q: "tea",
    conversationId: "CEXAMPLE", threadTs: "1700000000.000001", userId: "UEXAMPLE", cursor: "previous", limit: 2,
    latestPerConversation: true });
  expect(history.messages).toEqual([]);
  expect(history.nextCursor).toBe("next-page");
  expect(Object.fromEntries(new URL(String(fetch.mock.calls.at(-1)?.[0])).searchParams)).toEqual({
    identity_id: identity, workspace_id: "TEXAMPLE", q: "tea", conversation_id: "CEXAMPLE",
    thread_ts: "1700000000.000001", user_id: "UEXAMPLE", cursor: "previous", limit: "2", latest_per_conversation: "true",
  });
  reply(f.sources);
  const sources = await client.slack.listMessageSources(identity, f.deletion.id);
  expect(sources[0].observedAt).toBeInstanceOf(Date);
  expect(sources[0].applicationId).toBe(f.deletion.application_id);
  reply({ application: null, deletion: null });
  expect(await client.slack.getApplication(identity)).toEqual({ application: null, deletion: null });
});
