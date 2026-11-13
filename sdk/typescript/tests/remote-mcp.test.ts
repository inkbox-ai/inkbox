import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { RemoteMcp, REMOTE_MCP_VERSION } from "../src/remote-mcp.js";

let directory: string;
let tools: Record<string, unknown>[];
let calls: Record<string, unknown>[];
let respond: (params: Record<string, unknown>) => unknown;
let fetcher: ReturnType<typeof vi.fn>;
function client(identity = "agent-test", origin = "https://example.test") {
  return new RemoteMcp({ apiKey: "test-only", baseUrl: origin, identity, journalPath: directory });
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "remote-mcp-"));
  tools = [{ name: "send", description: "Send", inputSchema: { type: "object", properties: { text: { type: "string", minLength: 1 } }, required: ["text"], additionalProperties: false }, annotations: { readOnlyHint: false } }];
  calls = [];
  respond = params => params.requestState ? { content: [{ type: "text", text: "accepted" }], structuredContent: { id: "receipt-test" } } : { resultType: "input_required", requestState: "signed-test-state" };
  fetcher = vi.fn(async (_url, options) => {
    const request = JSON.parse(options.body);
    const result = request.method === "server/discover" ? { supportedVersions: [REMOTE_MCP_VERSION] } : request.method === "tools/list" ? { tools } : (calls.push(request.params), await respond(request.params));
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true }); });

describe("remote catalog", () => {
  it("preserves schemas, metadata and structured results without exposing mutable catalog state", async () => {
    const remote = client(); const catalog = await remote.refresh();
    expect(catalog).toEqual(tools); expect(remote.catalogDigest).toMatch(/^[0-9a-f]{64}$/);
    catalog[0].name = "changed";
    expect((await remote.call("send", { text: "hello" }, { callIdentity: "native-call-1" })).structuredContent).toEqual({ id: "receipt-test" });
    expect(calls).toHaveLength(2);
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
    expect(fetcher.mock.calls[0][1].headers["Mcp-Protocol-Version"]).toBe(REMOTE_MCP_VERSION);
  });
  it.each([
    [{ name: "duplicate", inputSchema: {} }, { name: "duplicate", inputSchema: {} }],
    [{ name: "bad name", inputSchema: {} }],
    [{ name: "send", inputSchema: { type: "imaginary" } }],
    [{ name: "send", inputSchema: { $schema: "https://example.test/schema" } }],
    [{ name: "send", inputSchema: {}, outputSchema: [] }],
    [{ name: "send", inputSchema: {}, annotations: [] }],
  ])("rejects invalid catalog without replacing its last valid generation: %j", async (...invalid) => {
    const remote = client(); await remote.refresh(); const digest = remote.catalogDigest;
    tools = invalid as Record<string, unknown>[];
    await expect(remote.refresh()).rejects.toThrow(); expect(remote.catalogDigest).toBe(digest);
    await expect(remote.call("send", { text: "hello" }, { callIdentity: "a" })).resolves.toHaveProperty("content");
  });
  it("removes tools at the next successful catalog refresh", async () => {
    const remote = client(); await remote.refresh(); tools = []; await remote.refresh();
    await expect(remote.call("send", {}, { callIdentity: "a" })).rejects.toThrow("unavailable");
    expect(calls).toEqual([]);
  });
  it.each(["http://example.test", "https://user:secret@example.test", "https://example.test/path", "https://example.test?token=secret", "file:///tmp/x"])("rejects an unsafe origin %s", origin => {
    expect(() => client("a", origin)).toThrow();
  });
  it("bounds remote response size", async () => {
    const remote = client(); await remote.refresh();
    fetcher.mockResolvedValueOnce(new Response("x".repeat(1_000_001)));
    await expect(remote.call("send", {}, { callIdentity: "a" })).rejects.toThrow("size limit");
  });
  it("rejects oversized, nonfinite and cyclic input before any call", async () => {
    const remote = client(); await remote.refresh(); const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const args of [{ text: "x".repeat(1_000_001) }, { n: NaN }, cyclic]) await expect(remote.call("send", args, { callIdentity: "a" })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("durable continuations", () => {
  it("reuses a persisted continuation after an unknown outcome, rechecking authority", async () => {
    const remote = client(); await remote.refresh();
    respond = params => { if (params.requestState) throw new TypeError("lost response"); return { resultType: "input_required", requestState: "same-operation" }; };
    await expect(remote.call("send", { text: "private message" }, { callIdentity: "native-1" })).rejects.toThrow("unavailable");
    const reopened = client(); await reopened.refresh(); respond = () => ({ content: [], structuredContent: { id: "accepted" } });
    const fence = vi.fn(); const submit = vi.fn();
    await reopened.call("send", { text: "private message" }, { callIdentity: "native-1", beforeExecute: fence, beforeSubmit: submit });
    expect(calls.map(call => call.requestState)).toEqual([undefined, "same-operation", "same-operation"]);
    expect(fence).toHaveBeenCalledTimes(1); expect(submit).toHaveBeenCalledTimes(1);
    expect(readdirSync(directory).map(name => readFileSync(join(directory, name), "utf8")).join()).not.toContain("private message");
  });
  it("does not merge independent identical sends and rejects changed arguments for the same identity", async () => {
    const remote = client(); await remote.refresh();
    await remote.call("send", { text: "same" }, { callIdentity: "first" });
    await remote.call("send", { text: "same" }, { callIdentity: "second" });
    expect(calls.map(call => call.requestState)).toEqual([undefined, "signed-test-state", undefined, "signed-test-state"]);
    await expect(remote.call("send", { text: "different" }, { callIdentity: "first" })).rejects.toThrow("different arguments");
  });
  it("binds immutable arguments before asynchronous approval callbacks", async () => {
    const remote = client(); await remote.refresh(); const args = { text: "original" };
    await remote.call("send", args, { callIdentity: "a", beforeExecute: () => { args.text = "changed"; } });
    expect(calls.map(call => call.arguments)).toEqual([{ text: "original" }, { text: "original" }]);
  });
  it("scopes operation identities to API origin and identity", async () => {
    for (const remote of [client(), client("another"), client("agent-test", "https://other.test")]) {
      await remote.refresh(); await remote.call("send", { text: "same" }, { callIdentity: "a" });
    }
    expect(readdirSync(directory).filter(name => name.endsWith(".state"))).toHaveLength(3);
  });
  it("concurrent clients converge on one continuation before submitting", async () => {
    const first = client(); const second = client(); await first.refresh(); await second.refresh(); let nonce = 0;
    respond = params => params.requestState ? { content: [] } : { resultType: "input_required", requestState: `nonce-${++nonce}` };
    await Promise.all([first, second].map(remote => remote.call("send", { text: "same" }, { callIdentity: "a" })));
    expect(new Set(calls.filter(call => call.requestState).map(call => call.requestState)).size).toBe(1);
  });
  it("rechecks the source after preparation and leaves the continuation available when revoked", async () => {
    const remote = client(); await remote.refresh(); let checks = 0; const submitted = vi.fn();
    await expect(remote.call("send", {}, { callIdentity: "a", beforeExecute: () => { if (++checks === 2) throw new Error("source revoked"); }, beforeSubmit: submitted })).rejects.toThrow("source revoked");
    expect(submitted).not.toHaveBeenCalled(); expect(calls).toHaveLength(1);
    expect(readdirSync(directory).filter(name => name.endsWith(".state"))).toHaveLength(1);
  });
  it("does not mark a read-only operation as a submitted write", async () => {
    respond = () => ({ content: [] }); const remote = client(); await remote.refresh(); const submit = vi.fn();
    await remote.call("send", {}, { callIdentity: "a", beforeSubmit: submit }); expect(submit).not.toHaveBeenCalled();
  });
  it("fails closed on unsupported interactions and repeated continuations", async () => {
    const remote = client(); await remote.refresh();
    respond = () => ({ resultType: "input_required", requestState: "a", elicitation: {} });
    await expect(remote.call("send", {}, { callIdentity: "a" })).rejects.toThrow("unsupported interaction");
    respond = () => ({ resultType: "input_required", requestState: "b" });
    await expect(remote.call("send", {}, { callIdentity: "b" })).rejects.toThrow("unsupported interaction");
    expect(calls).toHaveLength(3);
  });
  it("rejects symlinked journal directories", async () => {
    const remote = client(); await remote.refresh(); const link = `${directory}-link`; symlinkSync(directory, link);
    try { await expect(remote.call("send", {}, { callIdentity: "a", journalPath: link })).rejects.toThrow("owned directory"); }
    finally { rmSync(link); }
  });
  it("aborts in-flight HTTP and preserves an already-published continuation", async () => {
    vi.unstubAllGlobals();
    let submitted!: () => void; const pending = new Promise<void>(resolve => { submitted = resolve; });
    const server = createServer(async (req, res) => {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      if (request.params.requestState) { submitted(); return; }
      const result = request.method === "server/discover" ? { supportedVersions: [REMOTE_MCP_VERSION] } : request.method === "tools/list" ? { tools } : { resultType: "input_required", requestState: "durable" };
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as { port: number }; const remote = client("a", `http://127.0.0.1:${address.port}`); await remote.refresh();
      const abort = new AbortController(); const result = remote.call("send", {}, { callIdentity: "a", signal: abort.signal });
      const rejected = expect(result).rejects.toThrow("cancelled"); await pending; abort.abort(new Error("cancelled")); await rejected;
      expect(readdirSync(directory).filter(name => name.endsWith(".state"))).toHaveLength(1);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

describe("source-bound terminal replies", () => {
  const source = 'a'.repeat(64), args = 'b'.repeat(64);
  it("retains pending uncertainty through reopen and only accepts the matching submitted operation", () => {
    const journal = client().terminalReplies();
    expect(journal.lookup(source)).toBeNull();
    expect(journal.reserve(source, 'reply-1', args).state).toBe('pending');
    expect(() => journal.accept(source, 'reply-1', 'receipt-1')).toThrow();
    journal.markSubmitted(source, 'reply-1');
    const reopened = client().terminalReplies();
    expect(reopened.lookup(source)?.submitted).toBe(true);
    expect(() => reopened.reject(source, 'reply-1')).toThrow();
    expect(() => reopened.reserve(source, 'reply-2', args)).toThrow();
    expect(() => reopened.accept(source, 'reply-2', 'receipt-1')).toThrow();
    reopened.accept(source, 'reply-1', 'receipt-1');
    reopened.accept(source, 'reply-1', 'receipt-1');
    expect(reopened.reserve(source, 'other', 'c'.repeat(64))).toMatchObject({ state: 'accepted', acceptedId: 'receipt-1' });
    expect(() => reopened.accept(source, 'reply-1', 'receipt-2')).toThrow();
    expect(client('other').terminalReplies().lookup(source)).toBeNull();
  });
  it("allows a new intent after a definite pre-submission rejection, and fences stale callbacks", () => {
    const journal = client().terminalReplies();
    journal.reserve(source, 'reply-1', args); journal.reject(source, 'reply-1');
    journal.reject(source, 'reply-1');
    expect(() => journal.reserve(source, 'reply-1', 'c'.repeat(64))).toThrow('new operation identity');
    expect(journal.reserve(source, 'reply-2', 'c'.repeat(64)).state).toBe('pending');
    expect(() => journal.markSubmitted(source, 'reply-1')).toThrow();
    expect(() => journal.reject(source, 'reply-1')).toThrow();
    journal.markSubmitted(source, 'reply-2'); journal.accept(source, 'reply-2', 'receipt-2');
    expect(journal.lookup(source)?.acceptedId).toBe('receipt-2');
  });
  it("converges multiple owners on one reservation without overwriting intent", () => {
    const first = client().terminalReplies(), second = client().terminalReplies();
    first.reserve(source, 'reply-1', args);
    expect(second.reserve(source, 'reply-1', args)).toEqual(first.lookup(source));
    expect(() => second.reserve(source, 'reply-2', args)).toThrow();
    second.markSubmitted(source, 'reply-1');
    expect(() => first.reject(source, 'reply-1')).toThrow();
  });
  it("publishes exactly one competing intent across separate processes", async () => {
    const module = new URL('../src/remote-mcp.ts', import.meta.url).href;
    const run = (operation: string) => new Promise<string>((resolve, reject) => {
      const code = `import {RemoteMcp} from ${JSON.stringify(module)}; const journal=new RemoteMcp(${JSON.stringify({apiKey:'test',baseUrl:'https://example.test',identity:'agent-test',journalPath:directory})}).terminalReplies(); try {journal.reserve(${JSON.stringify(source)},${JSON.stringify(operation)},${JSON.stringify(args)}); process.stdout.write('reserved')} catch {process.stdout.write('conflict')}`;
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {stdio:['ignore','pipe','pipe']}); let output = '', errors = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
      child.on('error', reject); child.on('exit', status => status === 0 ? resolve(output) : reject(new Error(errors)));
    });
    expect((await Promise.all([run('first'),run('second')])).sort()).toEqual(['conflict','reserved']);
    expect(['first','second']).toContain(client().terminalReplies().lookup(source)?.operationId);
  });
});
