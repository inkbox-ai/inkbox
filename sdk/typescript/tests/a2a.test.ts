import { afterEach, describe, expect, it, vi } from "vitest";
import { A2AClient } from "../src/a2a/client.js";
import { A2AResource } from "../src/a2a/resource.js";
import type { HttpTransport } from "../src/_http.js";

afterEach(() => vi.unstubAllGlobals());

describe("A2AResource", () => {
  it("uses the exact task inbox path and query", async () => {
    const http = {
      get: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
    } as unknown as HttpTransport;
    const resource = new A2AResource(http);

    await resource.tasks("helper", { state: "submitted", cursor: "next", limit: 25 });

    expect(http.get).toHaveBeenCalledWith("/identities/helper/a2a/tasks", {
      state: "submitted",
      context_id: undefined,
      cursor: "next",
      limit: 25,
    });
  });

  it("uses the exact reply body", async () => {
    const http = {
      post: vi.fn().mockResolvedValue({
        id: "task-1",
        context_id: "context-1",
        state: "completed",
        caller: {
          identity_id: "caller-1",
          organization_id: "org-1",
          handle: "caller",
        },
        messages: [],
        transitions: [],
        completed_at: "2026-07-23T00:00:00Z",
        created_at: "2026-07-23T00:00:00Z",
        updated_at: "2026-07-23T00:00:00Z",
      }),
    } as unknown as HttpTransport;
    const resource = new A2AResource(http);

    await resource.reply("helper", "task-1", { intent: "complete", text: "Done" });

    expect(http.post).toHaveBeenCalledWith(
      "/identities/helper/a2a/tasks/task-1/reply",
      { intent: "complete", parts: [{ text: "Done" }] },
    );
  });
});

describe("A2AClient", () => {
  it("fetches a card without credentials and pins the key to Inkbox RPC", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "@helper",
        supportedInterfaces: [{
          url: "https://inkbox.ai/a2a/helper",
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          id: "task-1",
          contextId: "context-1",
          status: { state: "TASK_STATE_SUBMITTED" },
        },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new A2AClient("ApiKey_secret", "https://inkbox.ai");

    const target = await client.fetchCard("https://inkbox.ai/a2a/helper/card");
    await client.send(target, { text: "Investigate", messageId: "msg-1" });

    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("X-API-Key");
    const rpc = fetchMock.mock.calls[1][1];
    expect(rpc.headers["X-API-Key"]).toBe("ApiKey_secret");
    expect(rpc.headers["A2A-Version"]).toBe("1.0");
    expect(JSON.parse(rpc.body)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: {
        message: {
          messageId: "msg-1",
          role: "ROLE_USER",
          parts: [{ text: "Investigate" }],
        },
        configuration: { returnImmediately: true },
      },
    });
  });

  it("does not send the Inkbox key to an external agent", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "external",
        supportedInterfaces: [{
          url: "https://agent.example/rpc",
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          id: "task-1",
          contextId: "context-1",
          status: { state: "TASK_STATE_SUBMITTED" },
        },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new A2AClient("ApiKey_secret", "https://inkbox.ai");

    const target = await client.fetchCard("https://agent.example/card");
    await client.getTask(target, "task-1");

    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty("X-API-Key");
  });

  it("refuses card redirects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://attacker.example/card" },
      }),
    ));
    const client = new A2AClient("ApiKey_secret", "https://inkbox.ai");

    await expect(
      client.fetchCard("https://inkbox.ai/a2a/helper/card"),
    ).rejects.toThrow("redirects are refused");
  });
});
