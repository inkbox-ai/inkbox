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

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;

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

function requestTimeout(value: number): number {
  if (
    !Number.isFinite(value)
    || value <= 0
    || value > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new TypeError(
      `A2A request timeout must be between 1 and ${MAX_REQUEST_TIMEOUT_MS} ms`,
    );
  }
  return value;
}

async function withRequestTimeout<T>(
  timeoutMs: number,
  operation: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new InkboxError(`${operation} timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class A2AClient {
  private nextId = 0;
  private readonly platformOrigin: string;
  private readonly requestTimeoutMs: number;
  private readonly targetCredentials = new WeakMap<
    A2AResolvedTarget,
    string
  >();

  constructor(
    private readonly apiKey: string,
    platformBaseUrl: string,
    options: { requestTimeoutMs?: number } = {},
  ) {
    this.platformOrigin = origin(platformBaseUrl);
    this.requestTimeoutMs = requestTimeout(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
  }

  async fetchCard(
    cardUrl: string,
    options: {
      credential?: string;
      requestTimeoutMs?: number;
    } = {},
  ): Promise<A2AResolvedTarget> {
    const canonicalCardUrl = canonicalUrl(cardUrl);
    const cardOrigin = origin(canonicalCardUrl);
    const card = await withRequestTimeout(
      requestTimeout(options.requestTimeoutMs ?? this.requestTimeoutMs),
      "A2A Agent Card request",
      async (signal) => {
        const response = await fetch(canonicalCardUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(cardOrigin === this.platformOrigin
              ? { "X-API-Key": this.apiKey }
              : {}),
          },
          redirect: "manual",
          signal,
        });
        if (response.status >= 300 && response.status < 400) {
          throw new InkboxError("A2A Agent Card redirects are refused");
        }
        if (!response.ok) {
          throw new InkboxError(
            `A2A Agent Card request failed with HTTP ${response.status}`,
          );
        }
        return await response.json() as A2ACard;
      },
    );
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
    if (cardOrigin === this.platformOrigin) {
      if (origin(rpcUrl) !== this.platformOrigin) {
        throw new TypeError("Inkbox Agent Card points to a non-Inkbox RPC origin");
      }
      credential = this.apiKey;
    }
    const target: A2AResolvedTarget = Object.freeze({
      cardUrl: canonicalCardUrl,
      rpcUrl,
      protocolVersion: "1.0",
      card,
    });
    if (credential !== undefined) {
      this.targetCredentials.set(target, credential);
    }
    return target;
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
    if (result.task && typeof result.task === "object") {
      return { kind: "task", task: result.task as A2AWireTask };
    }
    if (result.message && typeof result.message === "object") {
      return { kind: "message", message: result.message as any };
    }
    // Accept direct payloads from older A2A implementations.
    return "status" in result && "id" in result
      ? { kind: "task", task: result as A2AWireTask }
      : { kind: "message", message: result as any };
  }

  async getTask(
    target: A2AResolvedTarget,
    taskId: string,
    options: {
      historyLength?: number;
      requestTimeoutMs?: number;
    } = {},
  ): Promise<A2AWireTask> {
    const result = await this.rpc<Record<string, any>>(
      target,
      "GetTask",
      {
        id: taskId,
        ...(options.historyLength === undefined
          ? {}
          : { historyLength: options.historyLength }),
      },
      requestTimeout(options.requestTimeoutMs ?? this.requestTimeoutMs),
    );
    return result.task && typeof result.task === "object"
      ? result.task as A2AWireTask
      : result as A2AWireTask;
  }

  async listTasks(
    target: A2AResolvedTarget,
    options: {
      contextId?: string;
      status?: A2AWireTaskState;
      cursor?: string;
      pageSize?: number;
      historyLength?: number;
      statusTimestampAfter?: string;
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
      ...(options.statusTimestampAfter === undefined
        ? {}
        : { statusTimestampAfter: options.statusTimestampAfter }),
    });
    return {
      tasks: raw.tasks ?? [],
      nextPageToken: raw.nextPageToken || null,
      pageSize: raw.pageSize ?? options.pageSize ?? 50,
      totalSize: raw.totalSize ?? 0,
    };
  }

  async cancel(target: A2AResolvedTarget, taskId: string): Promise<A2AWireTask> {
    const result = await this.rpc<Record<string, any>>(
      target,
      "CancelTask",
      { id: taskId },
    );
    return result.task && typeof result.task === "object"
      ? result.task as A2AWireTask
      : result as A2AWireTask;
  }

  async wait(
    target: A2AResolvedTarget,
    taskId: string,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<A2AWireTask> {
    const timeoutMs = requestTimeout(options.timeoutMs ?? 120_000);
    const intervalMs = requestTimeout(options.intervalMs ?? 5_000);
    const deadline = Date.now() + timeoutMs;
    const stopped = new Set<A2AWireTaskState>([
      "TASK_STATE_COMPLETED",
      "TASK_STATE_FAILED",
      "TASK_STATE_CANCELED",
      "TASK_STATE_REJECTED",
      "TASK_STATE_INPUT_REQUIRED",
      "TASK_STATE_AUTH_REQUIRED",
    ]);
    while (true) {
      const remainingBeforeRequest = deadline - Date.now();
      if (remainingBeforeRequest <= 0) {
        throw new InkboxError(
          `A2A task ${taskId} did not stop before timeout`,
        );
      }
      let task: A2AWireTask;
      try {
        task = await this.getTask(target, taskId, {
          requestTimeoutMs: Math.min(
            this.requestTimeoutMs,
            remainingBeforeRequest,
          ),
        });
      } catch (error) {
        if (Date.now() >= deadline) {
          throw new InkboxError(
            `A2A task ${taskId} did not stop before timeout`,
          );
        }
        throw error;
      }
      if (stopped.has(task.status.state)) return task;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new InkboxError(`A2A task ${taskId} did not stop before timeout`);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(intervalMs, remaining)),
      );
    }
  }

  private async rpc<T>(
    target: A2AResolvedTarget,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number = this.requestTimeoutMs,
  ): Promise<T> {
    const rpcUrl = target.rpcUrl;
    if (canonicalUrl(rpcUrl) !== rpcUrl) {
      throw new TypeError("A2A target RPC URL is not canonical");
    }
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "A2A-Version": "1.0",
    };
    const credential = this.targetCredentials.get(target);
    if (credential) headers["X-API-Key"] = credential;
    const payload = await withRequestTimeout(
      requestTimeout(timeoutMs),
      "A2A RPC request",
      async (signal) => {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers,
          redirect: "manual",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++this.nextId,
            method,
            params,
          }),
          signal,
        });
        if (response.status >= 300 && response.status < 400) {
          throw new InkboxError("A2A RPC redirects are refused");
        }
        if (!response.ok) {
          throw new InkboxError(
            `A2A RPC request failed with HTTP ${response.status}`,
          );
        }
        return await response.json() as {
          result?: T;
          error?: { code?: number; message?: string; data?: unknown };
        };
      },
    );
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
