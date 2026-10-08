import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Inkbox } from "../src/index.js";
import type { SlackPlanUpdate, SlackTaskChunk, SlackTaskUpdate } from "../src/index.js";

const data = JSON.parse(readFileSync(new URL("../../../tests/fixtures/slack_task_streams.json", import.meta.url), "utf8"));
afterEach(() => vi.unstubAllGlobals());
describe("task streams", () => {
  for (const c of data.cases) it(c.name, async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(c.response), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const s = new Inkbox({ apiKey: "synthetic-test-key" }).slack;
    const opts = { idempotencyKey: c.idempotency_key };
    let result;
    if (c.name.startsWith("start")) result = await s.startStream(data.connection_id, data.conversation_id, {
      ...opts, threadTs: c.body.thread_ts, recipientUserId: c.body.recipient_user_id,
      recipientTeamId: c.body.recipient_team_id, chunks: c.body.chunks,
      ...(c.name === "start_plan" ? { taskDisplayMode: "plan" as const } : {}),
    });
    else if (c.name === "append") result = await s.appendStream(data.connection_id, data.conversation_id, data.stream_id, { ...opts, chunks: c.body.chunks });
    else if (c.name.startsWith("stop")) result = await s.stopStream(data.connection_id, data.conversation_id, data.stream_id, { ...opts, ...(c.name === "stop_final" ? { chunks: c.body.chunks } : {}) });
    else result = await s.getOperationByKey(data.connection_id, opts);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = fetch.mock.calls[0];
    expect(new URL(url).pathname).toBe("/api/v1" + c.path);
    expect(new URL(url).search).toBe("");
    expect(request.method).toBe(c.method);
    expect(new Headers(request.headers).get("Idempotency-Key")).toBe(c.idempotency_key);
    expect(request.body ? JSON.parse(request.body) : null).toEqual(c.body);
    expect(result).toMatchObject({ id: data.stream_id, operation: c.response.operation,
      status: c.response.status, threadTs: data.thread_ts, retryAfter: c.response.retry_after });
  });
  it("exports discriminated chunks and defaults fields from older servers", async () => {
    const task: SlackTaskUpdate = { type: "task_update", id: "check", title: "Check", status: "in_progress" };
    const plan: SlackPlanUpdate = { type: "plan_update", title: "Review" };
    const chunks: SlackTaskChunk[] = [task, plan];
    expect(chunks).toHaveLength(2);
    const old = { ...data.cases[0].response, operation: "message_update" };
    delete old.thread_ts;
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(old)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection_id: data.connection_id, scopes: [],
        missing_scopes: [], capabilities: {}, native_processing_status: "unknown", max_upload_bytes: 100 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connection_id: data.connection_id, scopes: [],
        missing_scopes: [], capabilities: {}, native_processing_status: "unknown", max_upload_bytes: 100, native_task_streaming: "missing_scope" })));
    vi.stubGlobal("fetch", fetch);
    const s = new Inkbox({ apiKey: "synthetic-test-key" }).slack;
    expect((await s.getOperation(data.connection_id, data.stream_id)).threadTs).toBeNull();
    expect((await s.capabilities(data.connection_id)).nativeTaskStreaming).toBe("unknown");
    expect((await s.capabilities(data.connection_id)).nativeTaskStreaming).toBe("missing_scope");
  });
  it("rejects invalid lookup keys before HTTP and never retries a failed mutation", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Busy" }), { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const s = new Inkbox({ apiKey: "synthetic-test-key" }).slack;
    await expect(s.getOperationByKey(data.connection_id, { idempotencyKey: "bad key" })).rejects.toThrow("idempotencyKey");
    expect(fetch).not.toHaveBeenCalled();
    await expect(s.stopStream(data.connection_id, data.conversation_id, data.stream_id, { idempotencyKey: "stable" })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
