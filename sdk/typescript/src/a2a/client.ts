/** Stateless A2A 1.0 client with strict credential-origin pinning. */

import { InkboxError } from "../_http.js";
import type {
  A2ACard,
  A2AResolvedTarget,
  A2ASendResult,
  A2AWireTask,
  A2AWireTaskPage,
  A2AWireTaskState,
} from "./types.js";

export class A2AProtocolError extends InkboxError {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(`A2A error ${code}: ${message}`);
    this.name = "A2AProtocolError";
  }
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.hash) {
    throw new TypeError("A2A URLs cannot contain credentials or fragments");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new TypeError("A2A URLs must use HTTPS");
  }
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "https:" && url.port === "443")
    || (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  if (!url.pathname) url.pathname = "/";
  return url.toString();
}

function origin(value: string): string {
  return new URL(canonicalUrl(value)).origin;
}

export class A2AClient {
  private nextId = 0;
  private readonly platformOrigin: string;

  constructor(
    private readonly apiKey: string,
    platformBaseUrl: string,
  ) {
    this.platformOrigin = origin(platformBaseUrl);
  }

  async fetchCard(
    cardUrl: string,
    options: { credential?: string } = {},
  ): Promise<A2AResolvedTarget> {
    const canonicalCardUrl = canonicalUrl(cardUrl);
    const response = await fetch(canonicalCardUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      throw new InkboxError("A2A Agent Card redirects are refused");
    }
    if (!response.ok) {
      throw new InkboxError(`A2A Agent Card request failed with HTTP ${response.status}`);
    }
    const card = await response.json() as A2ACard;
    const selected = card.supportedInterfaces?.find(
      (item) =>
        item.protocolVersion === "1.0"
        && item.protocolBinding.toUpperCase() === "JSONRPC",
    );
    if (!selected) {
      throw new TypeError("Agent Card does not advertise A2A 1.0 JSON-RPC");
    }
    const rpcUrl = canonicalUrl(selected.url);
    let credential = options.credential;
    if (
      credential !== undefined
      && origin(rpcUrl) !== origin(canonicalCardUrl)
    ) {
      throw new TypeError(
        "External A2A credentials require matching card and RPC origins",
      );
    }
    if (origin(canonicalCardUrl) === this.platformOrigin) {
      if (origin(rpcUrl) !== this.platformOrigin) {
        throw new TypeError("Inkbox Agent Card points to a non-Inkbox RPC origin");
      }
      credential = this.apiKey;
    }
    return {
      cardUrl: canonicalCardUrl,
      rpcUrl,
      protocolVersion: "1.0",
      card,
      credential,
    };
  }

  async send(
    target: A2AResolvedTarget,
    options: {
      text?: string;
      parts?: Record<string, unknown>[];
      messageId?: string;
      contextId?: string;
      taskId?: string;
    },
  ): Promise<A2ASendResult> {
    if ((options.text === undefined) === (options.parts === undefined)) {
      throw new TypeError("Pass exactly one of text or parts");
    }
    const message: Record<string, unknown> = {
      messageId: options.messageId ?? crypto.randomUUID(),
      role: "ROLE_USER",
      parts: options.text === undefined ? options.parts : [{ text: options.text }],
    };
    if (options.contextId) message.contextId = options.contextId;
    if (options.taskId) message.taskId = options.taskId;
    const result = await this.rpc<Record<string, any>>(target, "SendMessage", {
      message,
      configuration: { returnImmediately: true },
    });
    return "status" in result && "id" in result
      ? { kind: "task", task: result as A2AWireTask }
      : { kind: "message", message: result as any };
  }

  getTask(
    target: A2AResolvedTarget,
    taskId: string,
    options: { historyLength?: number } = {},
  ): Promise<A2AWireTask> {
    return this.rpc(target, "GetTask", {
      id: taskId,
      ...(options.historyLength === undefined
        ? {}
        : { historyLength: options.historyLength }),
    });
  }

  async listTasks(
    target: A2AResolvedTarget,
    options: {
      contextId?: string;
      status?: A2AWireTaskState;
      cursor?: string;
      pageSize?: number;
      historyLength?: number;
    } = {},
  ): Promise<A2AWireTaskPage> {
    const raw = await this.rpc<Record<string, any>>(target, "ListTasks", {
      pageSize: options.pageSize ?? 50,
      ...(options.contextId ? { contextId: options.contextId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.cursor ? { pageToken: options.cursor } : {}),
      ...(options.historyLength === undefined
        ? {}
        : { historyLength: options.historyLength }),
    });
    return {
      tasks: raw.tasks ?? [],
      nextPageToken: raw.nextPageToken || null,
      pageSize: raw.pageSize ?? options.pageSize ?? 50,
      totalSize: raw.totalSize ?? 0,
    };
  }

  cancel(target: A2AResolvedTarget, taskId: string): Promise<A2AWireTask> {
    return this.rpc(target, "CancelTask", { id: taskId });
  }

  async wait(
    target: A2AResolvedTarget,
    taskId: string,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<A2AWireTask> {
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);
    const stopped = new Set<A2AWireTaskState>([
      "TASK_STATE_COMPLETED",
      "TASK_STATE_FAILED",
      "TASK_STATE_CANCELED",
      "TASK_STATE_REJECTED",
      "TASK_STATE_INPUT_REQUIRED",
      "TASK_STATE_AUTH_REQUIRED",
    ]);
    while (true) {
      const task = await this.getTask(target, taskId);
      if (stopped.has(task.status.state)) return task;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new InkboxError(`A2A task ${taskId} did not stop before timeout`);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(options.intervalMs ?? 5_000, remaining)),
      );
    }
  }

  private async rpc<T>(
    target: A2AResolvedTarget,
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    if (canonicalUrl(target.rpcUrl) !== target.rpcUrl) {
      throw new TypeError("A2A target RPC URL is not canonical");
    }
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "A2A-Version": "1.0",
    };
    if (target.credential) headers["X-API-Key"] = target.credential;
    const response = await fetch(target.rpcUrl, {
      method: "POST",
      headers,
      redirect: "manual",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.nextId,
        method,
        params,
      }),
    });
    if (response.status >= 300 && response.status < 400) {
      throw new InkboxError("A2A RPC redirects are refused");
    }
    if (!response.ok) {
      throw new InkboxError(`A2A RPC request failed with HTTP ${response.status}`);
    }
    const payload = await response.json() as {
      result?: T;
      error?: { code?: number; message?: string; data?: unknown };
    };
    if (payload.error) {
      throw new A2AProtocolError(
        payload.error.code ?? -32603,
        payload.error.message ?? "Unknown A2A error",
        payload.error.data,
      );
    }
    return payload.result as T;
  }
}
