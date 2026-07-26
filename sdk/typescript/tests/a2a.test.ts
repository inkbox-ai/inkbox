import { afterEach, describe, expect, it, vi } from "vitest";
import { A2AClient } from "../src/a2a/client.js";
import { A2AResource } from "../src/a2a/resource.js";
import type { HttpTransport } from "../src/_http.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function neverRespond(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) {
      reject(new Error("request is missing an abort signal"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(new Error("aborted")),
      { once: true },
    );
  });
}

describe("A2AResource", () => {
  it("parses participant task counts from settings", async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        enabled: true,
        filter_mode: "whitelist",
        skills: null,
        card_url: "https://example.test/a2a/helper/card",
        inbound_task_count: 3,
        outbound_task_count: 5,
        updated_at: null,
      }),
    } as unknown as HttpTransport;
    const resource = new A2AResource(http);

    const settings = await resource.settings("helper");

    expect(settings.inboundTaskCount).toBe(3);
    expect(settings.outboundTaskCount).toBe(5);
    expect(http.get).toHaveBeenCalledWith(
      "/identities/helper/a2a/settings",
    );
  });

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

  it("forwards context direction", async () => {
    const http = {
      get: vi.fn().mockResolvedValue({ items: [], next_cursor: "next-page" }),
    } as unknown as HttpTransport;
    const resource = new A2AResource(http);

    const page = await resource.contexts("coordinator", {
      direction: "both",
      cursor: "opaque",
      limit: 20,
    });

    expect(page.nextCursor).toBe("next-page");
    expect(http.get).toHaveBeenCalledWith(
      "/identities/coordinator/a2a/contexts",
      { direction: "both", cursor: "opaque", limit: 20 },
    );
  });

  it("updates and deletes contact rules through the admin routes", async () => {
    const http = {
      patch: vi.fn().mockResolvedValue({
        id: "rule-1",
        action: "block",
        match_type: "handle",
        match_target: "peer",
        direction: "both",
        status: "active",
        created_at: "2026-07-24T00:00:00Z",
        updated_at: "2026-07-25T00:00:00Z",
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as HttpTransport;
    const resource = new A2AResource(http);

    const updated = await resource.updateContactRule(
      "coordinator",
      "rule-1",
      { action: "block", direction: "both" },
    );
    await resource.deleteContactRule("coordinator", "rule-1");

    expect(updated.action).toBe("block");
    expect(http.patch).toHaveBeenCalledWith(
      "/identities/coordinator/a2a/contact-rules/rule-1",
      { action: "block", direction: "both" },
    );
    expect(http.delete).toHaveBeenCalledWith(
      "/identities/coordinator/a2a/contact-rules/rule-1",
    );
  });

  it("requires a contact-rule update field", async () => {
    const resource = new A2AResource({} as HttpTransport);
    await expect(
      resource.updateContactRule("coordinator", "rule-1", {}),
    ).rejects.toThrow(/at least one/);
  });

  it("sends outbound contact-rule direction", async () => {
    const http = {
      post: vi.fn().mockResolvedValue({
        id: "rule-1",
        action: "allow",
        match_type: "handle",
        match_target: "peer",
        direction: "outbound",
        status: "active",
        created_at: "2026-07-24T00:00:00Z",
        updated_at: "2026-07-25T00:00:00Z",
      }),
    } as unknown as HttpTransport;
    const resource = new A2AResource(http);

    const rule = await resource.addContactRule("coordinator", {
      handle: "peer",
      action: "allow",
      direction: "outbound",
    });

    expect(rule.direction).toBe("outbound");
    expect(http.post).toHaveBeenCalledWith(
      "/identities/coordinator/a2a/contact-rules",
      {
        action: "allow",
        match_type: "handle",
        match_target: "peer",
        direction: "outbound",
      },
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

  it("supports progress replies", async () => {
    const http = {
      post: vi.fn().mockResolvedValue({
        id: "task-1",
        context_id: "context-1",
        state: "working",
        caller: {
          identity_id: "caller-1",
          organization_id: "org-caller",
          handle: "caller",
        },
        messages: [],
        completed_at: null,
        created_at: "2026-07-23T00:00:00Z",
        updated_at: "2026-07-23T00:00:01Z",
      }),
    } as unknown as HttpTransport;
    const resource = new A2AResource(http);

    await resource.reply("helper", "task-1", {
      intent: "progress",
      text: "Still working",
    });

    expect(http.post).toHaveBeenCalledWith(
      "/identities/helper/a2a/tasks/task-1/reply",
      { intent: "progress", parts: [{ text: "Still working" }] },
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
    expect(Object.isFrozen(target)).toBe(true);
    expect(Object.keys(target)).not.toContain("credential");
    expect(JSON.stringify(target)).not.toContain("ApiKey_secret");
    expect(() => {
      (target as unknown as { rpcUrl: string }).rpcUrl =
        "https://attacker.example/rpc";
    }).toThrow();
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

  it("passes statusTimestampAfter to standard ListTasks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          tasks: [],
          nextPageToken: "",
          pageSize: 25,
          totalSize: 0,
        },
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new A2AClient("ApiKey_secret", "https://inkbox.ai");
    const target = {
      cardUrl: "https://agent.example/card",
      rpcUrl: "https://agent.example/rpc",
      protocolVersion: "1.0" as const,
      card: { name: "agent", supportedInterfaces: [] },
    };

    await client.listTasks(target, {
      pageSize: 25,
      statusTimestampAfter: "2026-07-25T12:30:00Z",
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      method: "ListTasks",
      params: {
        pageSize: 25,
        statusTimestampAfter: "2026-07-25T12:30:00Z",
      },
    });
  });

  it("times out an Agent Card request that never responds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init) => neverRespond(init)));
    const client = new A2AClient(
      "ApiKey_secret",
      "https://inkbox.ai",
      { requestTimeoutMs: 25 },
    );

    const pending = expect(
      client.fetchCard("https://agent.example/card"),
    ).rejects.toThrow("Agent Card request timed out after 25 ms");
    await vi.advanceTimersByTimeAsync(25);

    await pending;
  });

  it("enforces the wait deadline while an RPC request is stalled", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "external",
        supportedInterfaces: [{
          url: "https://agent.example/rpc",
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        }],
      }), { status: 200 }))
      .mockImplementationOnce((_url, init) => neverRespond(init));
    vi.stubGlobal("fetch", fetchMock);
    const client = new A2AClient("ApiKey_secret", "https://inkbox.ai");
    const target = await client.fetchCard("https://agent.example/card");

    const pending = expect(
      client.wait(target, "task-1", { timeoutMs: 25 }),
    ).rejects.toThrow("task task-1 did not stop before timeout");
    await vi.advanceTimersByTimeAsync(25);

    await pending;
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
