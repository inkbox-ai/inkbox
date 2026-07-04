/**
 * inkbox/phone/realtime/session.ts
 *
 * The realtime control channel: an async-iterable observe stream plus
 * intervene commands. `RealtimeResource.connect` opens the channel and
 * subscribes; the returned session yields typed events and sends commands.
 */

import { WebSocket } from "undici";

import { RealtimeEvent, parseEvent } from "./events.js";

const CONTROL_PATH = "/api/v1/phone/ws/realtime-control";

/** Transport seam over the control-channel socket (injectable for tests). */
export interface ControlTransport {
  send(text: string): void;
  /** Resolves the next inbound message, or `null` once the peer closes. */
  next(): Promise<string | null>;
  close(): Promise<void> | void;
}

export class RealtimeConnectError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "RealtimeConnectError";
    this.status = status;
  }
}

/**
 * Live observe + intervene handle for one control-channel connection.
 *
 * Async-iterate the session to receive observe events; call the intervene
 * methods to steer the live call.
 */
export class RealtimeControlSession implements AsyncIterable<RealtimeEvent> {
  constructor(private readonly transport: ControlTransport) {}

  async *[Symbol.asyncIterator](): AsyncIterator<RealtimeEvent> {
    for (;;) {
      const message = await this.transport.next();
      if (message === null) return;
      yield parseEvent(JSON.parse(message) as Record<string, unknown>);
    }
  }

  private send(command: Record<string, unknown>): void {
    this.transport.send(JSON.stringify(command));
  }

  /** Resolve a `consult.requested` with an answer for the caller. */
  answerConsult(consultId: string, answer: string, instructions?: string): void {
    const command: Record<string, unknown> = {
      event: "consult.answer",
      consult_id: consultId,
      answer,
    };
    if (instructions !== undefined) command["instructions"] = instructions;
    this.send(command);
  }

  /** Have the voice agent speak `text` on the call now. */
  say(callId: string, text: string): void {
    this.send({ event: "inject", call_id: callId, mode: "say", text });
  }

  /** Add hidden system context to the live session without speaking. */
  injectContext(callId: string, text: string): void {
    this.send({ event: "inject", call_id: callId, mode: "context", text });
  }

  /** Approve a tool call awaiting a decision. */
  approveTool(callId: string, toolCallId: string): void {
    this.send({
      event: "tool.decision",
      call_id: callId,
      tool_call_id: toolCallId,
      decision: "approve",
    });
  }

  /** Deny a tool call awaiting a decision. */
  denyTool(callId: string, toolCallId: string, reason?: string): void {
    const command: Record<string, unknown> = {
      event: "tool.decision",
      call_id: callId,
      tool_call_id: toolCallId,
      decision: "deny",
    };
    if (reason !== undefined) command["reason"] = reason;
    this.send(command);
  }

  /** Replace the live session instructions. */
  updateInstructions(callId: string, instructions: string): void {
    this.send({ event: "update_instructions", call_id: callId, instructions });
  }

  /** Force-end the call. */
  hangUp(callId: string, reason?: string): void {
    const command: Record<string, unknown> = { event: "hang_up", call_id: callId };
    if (reason !== undefined) command["reason"] = reason;
    this.send(command);
  }

  /** Close the control channel. */
  async close(): Promise<void> {
    await this.transport.close();
  }
}

export type TransportFactory = (
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
) => Promise<ControlTransport>;

export class RealtimeResource {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly transportFactory: TransportFactory;

  constructor(options: {
    apiKey: string;
    baseUrl: string;
    timeoutMs?: number;
    transportFactory?: TransportFactory;
  }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.transportFactory = options.transportFactory ?? defaultTransportFactory;
  }

  /**
   * Open the control channel and subscribe.
   *
   * Provide exactly one of `callId` (one live call) or `agentIdentityId`
   * (all live + future calls for the identity).
   */
  async connect(options: {
    callId?: string;
    agentIdentityId?: string;
  }): Promise<RealtimeControlSession> {
    const hasCall = options.callId !== undefined;
    const hasIdentity = options.agentIdentityId !== undefined;
    if (hasCall === hasIdentity) {
      throw new Error("pass exactly one of callId or agentIdentityId");
    }
    const transport = await this.transportFactory(
      this.controlUrl(),
      { "X-Service-Token": this.apiKey },
      this.timeoutMs,
    );
    const session = new RealtimeControlSession(transport);
    const subscribe: Record<string, unknown> = { event: "subscribe" };
    if (hasCall) subscribe["call_id"] = options.callId;
    else subscribe["agent_identity_id"] = options.agentIdentityId;
    try {
      transport.send(JSON.stringify(subscribe));
    } catch (err) {
      await transport.close();
      throw err;
    }
    return session;
  }

  private controlUrl(): string {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = CONTROL_PATH;
    return url.toString();
  }
}

/** Real transport: a client WebSocket with a backpressure-free message queue. */
async function defaultTransportFactory(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<ControlTransport> {
  const ws = new WebSocket(url, { headers });

  const queue: string[] = [];
  const waiters: Array<(v: string | null) => void> = [];
  let closed = false;

  const push = (value: string | null) => {
    const waiter = waiters.shift();
    if (waiter) waiter(value);
    else if (value !== null) queue.push(value);
  };

  ws.addEventListener("message", (ev: any) => {
    const data = ev.data;
    push(typeof data === "string" ? data : Buffer.from(data).toString("utf-8"));
  });
  ws.addEventListener("close", () => {
    closed = true;
    while (waiters.length) waiters.shift()!(null);
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new RealtimeConnectError("control channel connect timed out"));
    }, timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new RealtimeConnectError("control channel connect failed"));
    });
  });

  return {
    send(text: string) {
      ws.send(text);
    },
    next(): Promise<string | null> {
      if (queue.length) return Promise.resolve(queue.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiters.push(resolve));
    },
    async close() {
      ws.close();
    },
  };
}
