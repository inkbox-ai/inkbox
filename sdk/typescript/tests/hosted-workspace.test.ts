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
