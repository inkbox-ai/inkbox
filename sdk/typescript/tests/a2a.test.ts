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
      direction: undefined,
      requester_handle: undefined,
      worker_handle: undefined,
      state: "submitted",
      context_id: undefined,
      q: undefined,
      since: undefined,
      cursor: "next",
      limit: 25,
    });
  });

  it("uses the sent-task path and parses the target", async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        items: [{
          id: "task-1",
          context_id: "context-1",
          state: "completed",
          caller: {
            identity_id: "caller-1",
            organization_id: "org-caller",
            handle: "caller",
          },
          target: {
            identity_id: "target-1",
            organization_id: "org-target",
            handle: "helper",
          },
          messages: [],
          history_truncated: true,
          completed_at: "2026-07-24T00:00:00Z",
          created_at: "2026-07-24T00:00:00Z",
          updated_at: "2026-07-24T00:00:00Z",
        }],
        next_cursor: null,
      }),
    } as unknown as HttpTransport;
    const resource = new A2AResource(http);

    const page = await resource.sentTasks("caller", {
      state: "completed",
      cursor: "next",
      limit: 25,
    });

    expect(page.items[0].target?.handle).toBe("helper");
    expect(page.items[0].historyTruncated).toBe(true);
    expect(http.get).toHaveBeenCalledWith(
      "/identities/caller/a2a/sent/tasks",
      {
        requester_handle: undefined,
        worker_handle: undefined,
        state: "completed",
        context_id: undefined,
        q: undefined,
        since: undefined,
        cursor: "next",
        limit: 25,
      },
    );
  });

  it("uses exact task-history filter names", async () => {
    const http = {
      get: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
    } as unknown as HttpTransport;
    const resource = new A2AResource(http);

    await resource.tasks("coordinator", {
      direction: "both",
      requesterHandle: "coordinator",
      workerHandle: "researcher",
      state: "working",
      contextId: "context-1",
      q: "quarterly 2026",
      since: "2026-07-01T00:00:00Z",
      cursor: "opaque",
      limit: 20,
    });

    expect(http.get).toHaveBeenCalledWith(
      "/identities/coordinator/a2a/tasks",
      {
        direction: "both",
        requester_handle: "coordinator",
        worker_handle: "researcher",
        state: "working",
        context_id: "context-1",
        q: "quarterly 2026",
        since: "2026-07-01T00:00:00Z",
        cursor: "opaque",
        limit: 20,
      },
    );
  });

  it("lists matching messages with provenance and an opaque cursor", async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        items: [{
          id: "message-row-1",
          message_id: "protocol-message-1",
          task_id: "task-1",
          context_id: "context-1",
          task_state: "input_required",
          caller: {
            identity_id: "caller-1",
            organization_id: "org-caller",
            handle: "coordinator",
          },
          target: {
            identity_id: "worker-1",
            organization_id: "org-worker",
            handle: "researcher",
          },
          role: "agent",
          parts: [{ text: "Which quarter?" }],
          metadata: null,
          extensions: null,
          reference_task_ids: null,
          created_at: "2026-07-24T00:00:00Z",
        }],
        next_cursor: "next-page",
      }),
    } as unknown as HttpTransport;
    const resource = new A2AResource(http);

    const page = await resource.messages("coordinator", {
      direction: "both",
      requesterHandle: "coordinator",
      workerHandle: "researcher",
      taskId: "task-1",
      contextId: "context-1",
      role: "agent",
      q: "quarter",
      since: "2026-07-01T00:00:00Z",
      cursor: "opaque",
      limit: 10,
    });

    expect(page.nextCursor).toBe("next-page");
    expect(page.items[0].taskState).toBe("input_required");
    expect(page.items[0].caller.handle).toBe("coordinator");
    expect(page.items[0].target?.handle).toBe("researcher");
    expect(http.get).toHaveBeenCalledWith(
      "/identities/coordinator/a2a/messages",
      {
        direction: "both",
        requester_handle: "coordinator",
        worker_handle: "researcher",
        task_id: "task-1",
        context_id: "context-1",
        role: "agent",
        q: "quarter",
        since: "2026-07-01T00:00:00Z",
        cursor: "opaque",
        limit: 10,
      },
    );
  });

  it("keeps message filters while following pagination cursors", async () => {
    const http = {
      get: vi.fn()
        .mockResolvedValueOnce({ items: [], next_cursor: "page-2" })
        .mockResolvedValueOnce({ items: [], next_cursor: null }),
    } as unknown as HttpTransport;
    const resource = new A2AResource(http);

    const items = [];
    for await (const item of resource.iterMessages("coordinator", {
      direction: "outbound",
      workerHandle: "researcher",
      q: "invoice",
      since: "2026-07-01T00:00:00Z",
      limit: 5,
    })) {
      items.push(item);
    }

    expect(items).toEqual([]);
    const common = {
      direction: "outbound",
      requester_handle: undefined,
      worker_handle: "researcher",
      task_id: undefined,
      context_id: undefined,
      role: undefined,
      q: "invoice",
      since: "2026-07-01T00:00:00Z",
      limit: 5,
    };
    expect(http.get).toHaveBeenNthCalledWith(
      1,
      "/identities/coordinator/a2a/messages",
      { ...common, cursor: undefined },
    );
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      "/identities/coordinator/a2a/messages",
      { ...common, cursor: "page-2" },
    );
  });

  it("uses exact sent-task and sent-context detail paths", async () => {
    const http = {
      get: vi.fn()
        .mockResolvedValueOnce({
          id: "task-1",
          context_id: "context-1",
          state: "submitted",
          caller: {
            identity_id: "caller-1",
            organization_id: "org-caller",
            handle: "caller",
          },
          messages: [],
          completed_at: null,
          created_at: "2026-07-24T00:00:00Z",
          updated_at: "2026-07-24T00:00:00Z",
        })
        .mockResolvedValueOnce({
          id: "context-1",
          caller: {
            identity_id: "caller-1",
            organization_id: "org-caller",
            handle: "caller",
          },
          tasks: [],
          tasks_truncated: true,
          created_at: "2026-07-24T00:00:00Z",
          last_activity_at: "2026-07-24T00:00:00Z",
        }),
    } as unknown as HttpTransport;
    const resource = new A2AResource(http);

    await resource.sentTask("caller", "task-1");
    const context = await resource.sentContext("caller", "context-1");
    expect(context.tasksTruncated).toBe(true);

    expect(http.get).toHaveBeenNthCalledWith(
      1,
      "/identities/caller/a2a/sent/tasks/task-1",
    );
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      "/identities/caller/a2a/sent/contexts/context-1",
    );
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
          task: {
            id: "task-1",
            contextId: "context-1",
            status: { state: "TASK_STATE_SUBMITTED" },
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: {
          task: {
            id: "task-1",
            contextId: "context-1",
            status: { state: "TASK_STATE_SUBMITTED" },
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        result: {
          task: {
            id: "task-1",
            contextId: "context-1",
            status: { state: "TASK_STATE_CANCELED" },
          },
        },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new A2AClient("ApiKey_secret", "https://inkbox.ai");

    const target = await client.fetchCard("https://inkbox.ai/a2a/helper/card");
    const sent = await client.send(target, { text: "Investigate", messageId: "msg-1" });
    const fetched = await client.getTask(target, "task-1");
    const canceled = await client.cancel(target, "task-1");

    expect(sent.kind).toBe("task");
    expect(fetched.id).toBe("task-1");
    expect(canceled.status.state).toBe("TASK_STATE_CANCELED");

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
