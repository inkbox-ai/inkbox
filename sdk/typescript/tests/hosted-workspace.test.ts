import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpTransport } from "../src/_http.js";
import { HostedWorkspace, type ChatEvent } from "../src/hosted-workspace.js";
const events: ChatEvent[] = JSON.parse(
  readFileSync(
    new URL("../../../contracts/events-v1.json", import.meta.url),
    "utf8",
  ),
);
afterEach(() => vi.unstubAllGlobals());
describe("hosted workspace contract", () => {
  it("returns schedule history metadata without inventing pagination", async () => {
    const payload = {items:[{id:"occurrence",intended_due_at:"2026-01-01T00:00:00Z",state:"succeeded",reason:null}],conversation_id:"conversation",history_completeness:"partial"};
    const get = vi.fn().mockResolvedValue(payload);
    const workspace = new HostedWorkspace({get} as unknown as HttpTransport, "example-agent");
    const result = await workspace.scheduleHistory("schedule/id");
    expect(result).toEqual(payload);
    expect(result.conversation_id).toBe("conversation");
    expect(result.history_completeness).toBe("partial");
    expect(result.items[0].intended_due_at).toBe(payload.items[0].intended_due_at);
    expect(result).not.toHaveProperty("next_cursor");
    expect(get).toHaveBeenCalledWith("/example-agent/hosting/workspace/schedules/schedule%2Fid/occurrences", {});
  });
  it("renames with the supplied idempotency key", async () => {
    const patch = vi.fn().mockResolvedValue({ title: "Inbox review" });
    const workspace = new HostedWorkspace({ patch } as unknown as HttpTransport, "example-agent");
    await workspace.renameConversation("conversation", "Inbox review", "rename-once");
    expect(patch).toHaveBeenCalledWith(
      "/example-agent/hosting/chat/conversations/conversation",
      { title: "Inbox review" }, { headers: { "Idempotency-Key": "rename-once" } },
    );
  });
  it("forwards a selected model while preserving default request bodies", async () => {
    const post = vi.fn().mockResolvedValue({});
    const workspace = new HostedWorkspace({ post } as unknown as HttpTransport, "example-agent");
    const content = [{ type: "text" as const, text: "Hello" }];
    await workspace.send("conversation", content, "turn-default");
    expect(post.mock.calls[0][1]).toEqual({ content });
    await workspace.send("conversation", content, "turn-selected", "gpt-6.1-sol");
    expect(post.mock.calls[1][1]).toEqual({ content, model: "gpt-6.1-sol" });
  });
  it("surfaces stream resets without replay", async () => {
    const fetch = vi.fn(async () => new Response(
      'event: stream.reset\ndata: {"code":"event_cursor_expired","status":410}\n\n',
    ));
    vi.stubGlobal("fetch", fetch);
    const stream = new HttpTransport("synthetic-key", "https://example.test").streamEvents("/events");
    await expect(stream.next()).rejects.toMatchObject({
      statusCode: 410, detail: { code: "event_cursor_expired" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("streams the shared typed events and forwards the cursor", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          ": keepalive\n\n" +
            events
              .map((e) => `id: ${e.cursor}\ndata: ${JSON.stringify(e)}\n\n`)
              .join(""),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const workspace = new HostedWorkspace(
      new HttpTransport("synthetic-key", "https://example.test"),
      "example-agent",
    );
    const received = [];
    for await (const event of workspace.streamEvents("conversation", "resume"))
      received.push(event);
    expect(received).toEqual(events);
    if (received[0].type === "message.created") expect(received[0].data.phase).toBe("commentary");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("after=resume");
    const request = received.find((e) => e.type === "interaction.created");
    if (request?.type === "interaction.created")
      expect(request.data.effective_scope).toBe("operation");
  });
  it("preserves interaction version and idempotency", async () => {
    const post = vi.fn().mockResolvedValue({ status: "submitted" });
    const workspace = new HostedWorkspace(
      { post } as unknown as HttpTransport,
      "example-agent",
    );
    await workspace.respond(
      "conversation",
      "request",
      3,
      { kind: "approval", decision: "deny" },
      "answer-once",
    );
    expect(post).toHaveBeenCalledWith(
      "/example-agent/hosting/chat/conversations/conversation/interactions/request/response",
      { expected_version: 3, response: { kind: "approval", decision: "deny" } },
      { headers: { "Idempotency-Key": "answer-once" } },
    );
  });
});

it("saves permission mode on the chat with an idempotency key", async () => {
  const patch = vi.fn().mockResolvedValue({ permission_mode: "yolo" });
  const workspace = new HostedWorkspace({ patch } as unknown as HttpTransport, "example-agent");
  await workspace.setPermissionMode("conversation", "yolo", "mode-once");
  expect(patch).toHaveBeenCalledWith(
    "/example-agent/hosting/chat/conversations/conversation",
    { permission_mode: "yolo" }, { headers: { "Idempotency-Key": "mode-once" } },
  );
});

it("consumes authoritative operation, history, file-turn and validation fixtures", async () => {
  const wire = JSON.parse(readFileSync(new URL("../../../contracts/hosted-workspace-v1.json", import.meta.url), "utf8"));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const workspace = new HostedWorkspace(new HttpTransport("synthetic-key", "https://example.test"), "example");
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(wire.operation)));
  expect(await workspace.operation("operation")).toEqual(wire.operation);
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(wire.schedule_history)));
  expect(await workspace.scheduleHistory("schedule")).toEqual(wire.schedule_history);
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(wire.cadence_error), {status:400}));
  await expect(workspace.send("conversation", wire.file_turn.content, "once")).rejects.toMatchObject({statusCode:400,detail:wire.cadence_error.detail});
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual(wire.file_turn);
});
