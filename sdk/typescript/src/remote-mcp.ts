import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

export const REMOTE_MCP_VERSION = "2026-07-28";
const MESSAGE_BYTES = 1_000_000;
const CATALOG_BYTES = 4_000_000;
const MAX_CALLS = 20_000;
const schemaValidator = new Ajv2020({ strict: false, validateFormats: false });
export type RemoteTool = { name: string; description?: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>; annotations?: Record<string, unknown>; [key: string]: unknown };
export type RemoteToolResult = { content: unknown[]; isError?: boolean; structuredContent?: Record<string, unknown>; [key: string]: unknown };
export type RemoteCallOptions = { callIdentity: string; journalPath?: string; signal?: AbortSignal; beforeExecute?: () => void | Promise<void>; beforeSubmit?: () => void | Promise<void> };
export class RemoteToolError extends Error {}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function bounded(value: unknown): void {
  const pending: [unknown, number][] = [[value, 0]];
  let count = 0;
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (++count > 50_000 || depth > 64) throw new RemoteToolError("Remote JSON exceeds its structural limits");
    if (typeof item === "number" && !Number.isFinite(item)) throw new RemoteToolError("Remote JSON contains an invalid number");
    if (typeof item === "undefined" || typeof item === "bigint" || typeof item === "function" || typeof item === "symbol") throw new RemoteToolError("Remote JSON contains an invalid value");
    if (item && typeof item === "object") {
      if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new RemoteToolError("Remote JSON requires plain objects");
      for (const child of Object.values(item)) pending.push([child, depth + 1]);
    }
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function validateSchema(value: unknown): void {
  if (!object(value) || (value.$schema !== undefined && value.$schema !== "https://json-schema.org/draft/2020-12/schema")) throw new RemoteToolError("Unsupported remote tool schema dialect");
  try { if (!schemaValidator.validateSchema(value)) throw new Error(); }
  catch { throw new RemoteToolError("Invalid remote tool schema"); }
}

class CallJournal {
  constructor(readonly path: string, readonly scope: string) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const stat = lstatSync(path);
    if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid()) || (process.platform !== "win32" && (stat.mode & 0o077))) throw new RemoteToolError("Tool-call history must be a private owned directory");
  }
  protected read(name: string): string | null {
    let fd: number;
    try { fd = openSync(join(this.path, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 16_384 || (process.getuid && stat.uid !== process.getuid()) || (process.platform !== "win32" && (stat.mode & 0o077))) throw new RemoteToolError("Invalid tool-call history file");
      return readFileSync(fd, "utf8");
    } finally { closeSync(fd); }
  }
  protected publish(name: string, value: string): string {
    const existing = this.read(name);
    if (existing !== null) return existing;
    const temporary = join(this.path, `.${randomUUID()}`);
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      writeFileSync(fd, value, "utf8"); fsyncSync(fd);
      try { linkSync(temporary, join(this.path, name)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      if (process.platform !== "win32") {
        const directory = openSync(this.path, constants.O_RDONLY);
        try { fsyncSync(directory); } finally { closeSync(directory); }
      }
    } finally { closeSync(fd); unlinkSync(temporary); }
    return this.read(name)!;
  }
  begin(identity: string, name: string, args: Record<string, unknown>): { id: string; state: string | null } {
    const id = hash([this.scope, identity]);
    const fingerprint = hash([name, args]);
    if (this.read(`${id}.call`) === null && readdirSync(this.path).filter(name => name.endsWith(".call")).length >= MAX_CALLS) throw new RemoteToolError("Tool-call history is full; inspect it before continuing");
    if (this.publish(`${id}.call`, fingerprint) !== fingerprint) throw new RemoteToolError("A tool-call identity cannot be reused with different arguments");
    return { id, state: this.read(`${id}.state`) };
  }
  bind(id: string, state: string): string { return this.publish(`${id}.state`, state); }
}

/** Refresh between native turns. Retain the journal until its logical session is retired. */
export class RemoteMcp {
  readonly url: string;
  readonly journalPath: string;
  private readonly apiKey: string;
  private readonly scope: string;
  private catalog: RemoteTool[] = [];
  private validators = new Map<string, ValidateFunction>();
  catalogDigest: string | null = null;
  constructor(options: { apiKey: string; baseUrl: string; identity: string; journalPath: string }) {
    const url = new URL(options.baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new TypeError("Remote tools require an HTTPS API origin");
    this.url = `${url.origin}/mcp`; this.apiKey = options.apiKey;
    this.scope = canonical([this.url, options.identity]); this.journalPath = options.journalPath;
  }
  terminalReplies(options: { journalPath?: string } = {}): TerminalReplyJournal {
    return new TerminalReplyJournal(options.journalPath ?? this.journalPath, this.scope);
  }
  private async request(method: string, params: Record<string, unknown>, signal?: AbortSignal, limit = MESSAGE_BYTES): Promise<Record<string, unknown>> {
    const id = randomUUID();
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": REMOTE_MCP_VERSION, "io.modelcontextprotocol/clientCapabilities": { elicitation: {} } } } });
    if (Buffer.byteLength(payload) > MESSAGE_BYTES) throw new RemoteToolError("Tool request exceeds the size limit; stage files separately");
    const headers: Record<string, string> = { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': REMOTE_MCP_VERSION, 'Mcp-Method': method };
    if (method === 'tools/call') headers['Mcp-Name'] = String(params.name);
    const deadline = AbortSignal.timeout(55_000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let body: unknown;
    try {
      const response = await fetch(this.url, { method: 'POST', body: payload, headers, redirect: 'error', signal: combined });
      if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new RemoteToolError(`Remote tool request failed (HTTP ${response.status})`); }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > limit) throw new RemoteToolError("Remote tool response exceeds the size limit");
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel(); reader.releaseLock(); }
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new RemoteToolError("Invalid remote tool response"); }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof RemoteToolError) throw error;
      throw new RemoteToolError("Remote tool outcome is unavailable; retain the same call identity");
    }
    bounded(body);
    if (!object(body) || body.jsonrpc !== '2.0' || body.id !== id) throw new RemoteToolError("Invalid remote tool response");
    if ('error' in body) throw new RemoteToolError(`Remote tool request failed (code ${object(body.error) && Number.isInteger(body.error.code) ? body.error.code : 'unknown'})`);
    if (!object(body.result)) throw new RemoteToolError("Invalid remote tool result");
    return body.result;
  }
  async refresh(options: { signal?: AbortSignal } = {}): Promise<RemoteTool[]> {
    const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]);
    const discovery = await this.request('server/discover', {}, signal);
    if (!Array.isArray(discovery.supportedVersions) || !discovery.supportedVersions.includes(REMOTE_MCP_VERSION)) throw new RemoteToolError("The remote tool protocol is unsupported");
    const catalog: RemoteTool[] = []; const names = new Set<string>(); const cursors = new Set<string>();
    const validators = new Map<string, ValidateFunction>();
    let params: Record<string, unknown> = {}; let total = 0;
    for (let page = 0; page < 16; page++) {
      const result = await this.request('tools/list', params, signal, CATALOG_BYTES);
      total += Buffer.byteLength(canonical(result));
      if (!Array.isArray(result.tools) || catalog.length + result.tools.length > 512 || total > CATALOG_BYTES) throw new RemoteToolError("Remote tool catalog exceeds its limits");
      for (const row of result.tools) {
        if (!object(row) || typeof row.name !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(row.name) || names.has(row.name) || (row.description !== undefined && typeof row.description !== 'string') || (row.annotations !== undefined && !object(row.annotations))) throw new RemoteToolError("Invalid remote tool catalog");
        validateSchema(row.inputSchema); if ('outputSchema' in row) validateSchema(row.outputSchema);
        try { validators.set(row.name, new Ajv2020({ strict: false, validateFormats: false }).compile(row.inputSchema as Record<string, unknown>)); }
        catch { throw new RemoteToolError("Invalid or unresolved remote tool schema"); }
        names.add(row.name); catalog.push(row as RemoteTool);
      }
      if (result.nextCursor == null) {
        this.catalog = structuredClone(catalog); this.validators = validators; this.catalogDigest = hash(catalog);
        return structuredClone(catalog);
      }
      if (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor.length > 4096 || cursors.has(result.nextCursor)) throw new RemoteToolError("Invalid remote catalog cursor");
      cursors.add(result.nextCursor); params = { cursor: result.nextCursor };
    }
    throw new RemoteToolError("Remote tool catalog exceeds its page limit");
  }
  async call(name: string, args: Record<string, unknown>, options: RemoteCallOptions): Promise<RemoteToolResult> {
    if (!this.catalog.some(tool => tool.name === name)) throw new RemoteToolError("The tool is unavailable in this catalog generation");
    if (typeof options.callIdentity !== 'string' || !options.callIdentity || options.callIdentity.length > 1024) throw new TypeError("A stable tool-call identity is required");
    if (!object(args)) throw new TypeError("Tool arguments must be an object");
    bounded(args);
    if (Buffer.byteLength(canonical(args)) > MESSAGE_BYTES) throw new RemoteToolError("Tool arguments exceed the size limit; stage files separately");
    args = JSON.parse(canonical(args));
    if (!this.validators.get(name)!(args)) throw new RemoteToolError("Tool arguments do not match the remote schema");
    const journal = new CallJournal(options.journalPath ?? this.journalPath, this.scope);
    const record = journal.begin(options.callIdentity, name, args);
    const execute = async (state: string | null) => {
      options.signal?.throwIfAborted(); await options.beforeExecute?.();
      if (state !== null) await options.beforeSubmit?.();
      options.signal?.throwIfAborted();
      return this.request('tools/call', { name, arguments: args, ...(state !== null ? { requestState: state } : {}) }, options.signal);
    };
    let result = await execute(record.state);
    if (result.resultType === 'input_required') {
      if (Object.keys(result).sort().join(',') !== 'requestState,resultType') throw new RemoteToolError("The tool requires an unsupported interaction");
      if (record.state !== null || typeof result.requestState !== 'string' || !result.requestState || result.requestState.length > 2048) throw new RemoteToolError("Invalid tool continuation; the operation was not repeated");
      const state = journal.bind(record.id, result.requestState);
      result = await execute(state);
      if (result.resultType === 'input_required') throw new RemoteToolError("The tool requires an unsupported interaction");
    }
    if (!Array.isArray(result.content)) throw new RemoteToolError("Invalid remote tool result");
    return result as RemoteToolResult;
  }
}

export type TerminalReply = { operationId: string; argumentsHash: string; state: 'pending' | 'accepted' | 'rejected'; submitted: boolean; acceptedId: string | null };

/** Source-bound terminal intent. Records contain hashes and receipts, never messages. */
export class TerminalReplyJournal extends CallJournal {
  private source(sourceHash: string): string {
    if (!/^[0-9a-f]{64}$/.test(sourceHash)) throw new TypeError("A source hash is required");
    return `terminal-${hash([this.scope, sourceHash])}`;
  }
  private latest(sourceHash: string): { prefix: string; record: TerminalReply; generation: number } | null {
    const source = this.source(sourceHash);
    let latest: { prefix: string; record: TerminalReply; generation: number } | null = null;
    for (let generation = 0; generation < MAX_CALLS; generation++) {
      const prefix = `${source}.${generation}`; const raw = this.read(`${prefix}.reserve`);
      if (raw === null) return latest;
      let reservation: unknown;
      try { reservation = JSON.parse(raw); } catch { throw new RemoteToolError("Invalid terminal reply history"); }
      if (!object(reservation) || typeof reservation.operationId !== 'string' || typeof reservation.argumentsHash !== 'string' || !/^[0-9a-f]{64}$/.test(reservation.argumentsHash)) throw new RemoteToolError("Invalid terminal reply history");
      const decision = this.read(`${prefix}.decision`); const acceptedId = this.read(`${prefix}.accepted`);
      if (decision !== null && decision !== 'submitted' && decision !== 'rejected' || acceptedId !== null && decision !== 'submitted') throw new RemoteToolError("Invalid terminal reply history");
      latest = { prefix, generation, record: { operationId: reservation.operationId, argumentsHash: reservation.argumentsHash, state: acceptedId !== null ? 'accepted' : decision === 'rejected' ? 'rejected' : 'pending', submitted: decision === 'submitted', acceptedId } };
      if (latest.record.state !== 'rejected') return latest;
    }
    throw new RemoteToolError("Terminal reply history is full; inspect it before continuing");
  }
  lookup(sourceHash: string): TerminalReply | null { return this.latest(sourceHash)?.record ?? null; }
  reserve(sourceHash: string, operationId: string, argumentsHash: string): TerminalReply {
    if (typeof operationId !== 'string' || !operationId || operationId.length > 1024) throw new TypeError("A stable reply operation identity is required");
    if (!/^[0-9a-f]{64}$/.test(argumentsHash)) throw new TypeError("A reply argument hash is required");
    const latest = this.latest(sourceHash);
    if (latest?.record.state === 'accepted') return latest.record;
    if (latest?.record.state === 'pending') {
      if (latest.record.operationId !== operationId || latest.record.argumentsHash !== argumentsHash) throw new RemoteToolError("A terminal reply is pending; reconcile its original operation");
      return latest.record;
    }
    if (latest && latest.record.operationId === operationId && latest.record.argumentsHash !== argumentsHash) throw new RemoteToolError("Changed reply arguments require a new operation identity");
    if (readdirSync(this.path).filter(name => name.endsWith('.reserve')).length >= MAX_CALLS) throw new RemoteToolError("Terminal reply history is full; inspect it before continuing");
    const prefix = `${this.source(sourceHash)}.${latest ? latest.generation + 1 : 0}`;
    const reservation = canonical({ operationId, argumentsHash });
    if (this.publish(`${prefix}.reserve`, reservation) !== reservation) throw new RemoteToolError("A terminal reply is pending; reconcile its original operation");
    return this.lookup(sourceHash)!;
  }
  markSubmitted(sourceHash: string, operationId: string): void {
    const latest = this.latest(sourceHash);
    if (!latest || latest.record.operationId !== operationId || latest.record.state !== 'pending' || this.publish(`${latest.prefix}.decision`, 'submitted') !== 'submitted') throw new RemoteToolError("The terminal reply is no longer pending");
  }
  reject(sourceHash: string, operationId: string): void {
    const latest = this.latest(sourceHash);
    if (!latest || latest.record.operationId !== operationId || latest.record.submitted || this.publish(`${latest.prefix}.decision`, 'rejected') !== 'rejected') throw new RemoteToolError("A submitted or accepted terminal reply cannot be discarded");
  }
  accept(sourceHash: string, operationId: string, acceptedId: string): void {
    if (typeof acceptedId !== 'string' || !acceptedId || acceptedId.length > 512) throw new TypeError("A reply acceptance receipt is required");
    const latest = this.latest(sourceHash);
    if (!latest || latest.record.operationId !== operationId || !latest.record.submitted || this.publish(`${latest.prefix}.accepted`, acceptedId) !== acceptedId) throw new RemoteToolError("The terminal reply receipt does not match its pending operation");
  }
}
