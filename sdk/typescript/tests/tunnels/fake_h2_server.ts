/**
 * tests/tunnels/fake_h2_server.ts
 *
 * In-process fake tunnel server. Backed by a real
 * `http2.createSecureServer` on an ephemeral port; honors enough of the
 * `/_system/*` protocol to exercise the runtime end-to-end without a
 * production tunnel-server dependency.
 *
 * `withholdWindowUpdate` is intentionally NOT exposed — Node's
 * high-level h2 server auto-credits, so per-stream WINDOW_UPDATE
 * control isn't reachable from the public API.
 */

import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { generateSelfSignedCert } from "./_test_cert.js";

interface IntakeResponse {
  status: number;
  headers: Array<[string, string]>;
  body: Buffer;
}

interface PendingResponsePost {
  resolve: (v: {
    headers: http2.IncomingHttpHeaders;
    body: Buffer;
    sessionIdx: number;
  }) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface PendingIntakePost {
  resolve: (v: { slot: number; ownerToken: string }) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface FakeH2ServerOpts {
  /** Override the helloResponse JSON (default: status=200 owner_token=ok). */
  helloBody?: Record<string, unknown>;
  /** Override hello status (default: 200). */
  helloStatus?: number;
}

export interface FakeH2Server {
  url: string;
  port: number;
  authority: string;
  setHelloResponse(status: number, body: Record<string, unknown>): void;
  /**
   * Install a function that returns a fresh hello response on every
   * request — useful for testing reconnect flows where each hello
   * should mint a new owner_token.
   */
  setHelloResponseFn(
    fn: () => { status: number; body: Record<string, unknown> },
  ): void;
  /**
   * Queue an intake response (one-shot). The next `/_system/intake`
   * POST consumes one queued response. Pass `null` to leave a stream
   * parked indefinitely.
   */
  setIntakeResponse(response: IntakeResponse | null): void;
  /**
   * Set a sticky intake response that's used whenever the queue is
   * empty. Useful for tests that want every intake to receive the
   * same answer (e.g. owner-token rotation needs to keep 401-ing).
   * Pass `null` to clear back to "park indefinitely".
   */
  setStickyIntakeResponse(response: IntakeResponse | null): void;
  /** Subscribe to session-level events (`goaway`, `close`) for ordering tests. */
  onSessionEvent(cb: (kind: "goaway" | "close") => void): void;
  /** Live (not-yet-closed) client session count — for make-before-break tests. */
  sessionCount(): number;
  /** Total `/_system/hello` POSTs seen since start. */
  helloCount(): number;
  injectGoaway(errorCode?: number): void;
  injectRstStream(streamId: number, errorCode: number): void;
  receivedHelloHeaders(): http2.IncomingHttpHeaders | null;
  receivedIntakePosts(): Array<{ slot: number; ownerToken: string }>;
  awaitResponsePost(
    requestId: string,
    timeoutMs?: number,
  ): Promise<{
    headers: http2.IncomingHttpHeaders;
    body: Buffer;
    sessionIdx: number;
  }>;
  awaitNextIntakePost(timeoutMs?: number): Promise<{ slot: number; ownerToken: string }>;
  /**
   * Resolve when an extended-CONNECT stream arrives at the given path
   * (e.g. `/_system/tcp/tcp-1` or `/_system/ws/ws-1`). The caller is
   * expected to drive the bridge end-to-end (respond 200, pump data).
   * Time-bounded.
   */
  awaitNextBridgeStream(
    path: string,
    timeoutMs?: number,
  ): Promise<http2.ServerHttp2Stream>;
  close(): Promise<void>;
}

export async function startFakeH2Server(
  opts: FakeH2ServerOpts = {},
): Promise<FakeH2Server> {
  const { cert, key } = await generateSelfSignedCert();
  const server = http2.createSecureServer({
    cert,
    key,
    allowHTTP1: false,
    settings: {
      // Advertise extended-CONNECT support so client streams with
      // `:protocol` are allowed by spec.
      enableConnectProtocol: true,
    },
  });

  let helloStatus = opts.helloStatus ?? 200;
  let helloBody: Record<string, unknown> =
    opts.helloBody ?? {
      owner_token: "tok-test",
      default_pool_size: 1,
      response_deadline_seconds: 30,
      intake_idle_seconds: 600,
    };
  let helloFn:
    | (() => { status: number; body: Record<string, unknown> })
    | null = null;

  const intakeQueue: Array<IntakeResponse | null> = [];
  let stickyIntake: IntakeResponse | null = null;
  // Streams currently parked because the queue was empty at POST
  // time. When a new response is enqueued via setIntakeResponse, the
  // first parked stream gets delivered to — matching the real tunnel
  // server's "push envelope to whichever pool slot is parked" semantic.
  const parkedIntakeStreams: http2.ServerHttp2Stream[] = [];

  const writeIntakeResponse = (
    stream: http2.ServerHttp2Stream,
    next: IntakeResponse,
  ): void => {
    const respHeaders: http2.OutgoingHttpHeaders = {
      ":status": next.status,
    };
    for (const [k, v] of next.headers) {
      const existing = respHeaders[k];
      if (existing === undefined) {
        respHeaders[k] = v;
      } else if (Array.isArray(existing)) {
        existing.push(v);
      } else {
        respHeaders[k] = [String(existing), v];
      }
    }
    try {
      stream.respond(respHeaders);
      stream.end(next.body);
    } catch {
      /* swallow — stream may have been closed */
    }
  };
  const sessionEventListeners: Array<(kind: "goaway" | "close") => void> = [];
  let receivedHello: http2.IncomingHttpHeaders | null = null;
  const intakePosts: Array<{ slot: number; ownerToken: string }> = [];
  const pendingResponses = new Map<string, PendingResponsePost>();
  const intakeWaiters: PendingIntakePost[] = [];
  let nextUnclaimedIntakeIdx = 0;
  const sessions = new Set<http2.ServerHttp2Session>();
  // Stable per-session index (creation order) so response-post tests can
  // assert which connection a reply rode in on (0 = first, 1 = second…).
  const sessionIndex = new Map<http2.ServerHttp2Session, number>();
  let nextSessionIndex = 0;
  let helloCounter = 0;
  // Bridge-stream waiters. The map is keyed by exact path string.
  const bridgeWaiters = new Map<
    string,
    Array<{
      resolve: (s: http2.ServerHttp2Stream) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }>
  >();

  server.on("session", (session) => {
    sessions.add(session);
    sessionIndex.set(session, nextSessionIndex++);
    session.on("goaway", () => {
      for (const cb of sessionEventListeners) cb("goaway");
    });
    session.on("close", () => {
      for (const cb of sessionEventListeners) cb("close");
      sessions.delete(session);
    });
  });

  server.on("stream", (stream, headers) => {
    const path = headers[":path"];
    if (typeof path !== "string") {
      stream.respond({ ":status": 400 });
      stream.end();
      return;
    }
    if (path === "/_system/hello") {
      receivedHello = headers;
      helloCounter += 1;
      const computed = helloFn !== null
        ? helloFn()
        : { status: helloStatus, body: helloBody };
      stream.respond({
        ":status": computed.status,
        "content-type": "application/json",
      });
      if (computed.status === 200) {
        stream.end(JSON.stringify(computed.body));
      } else {
        stream.end();
      }
      return;
    }
    if (path === "/_system/intake") {
      const slotRaw = headers["x-pool-slot"];
      const slot = parseInt(typeof slotRaw === "string" ? slotRaw : "0", 10);
      const ownerToken = String(headers["x-owner-token"] ?? "");
      const post = { slot, ownerToken };
      intakePosts.push(post);
      // Wake any awaiter; otherwise leave the post for awaitNextIntakePost
      // to pick up later via nextUnclaimedIntakeIdx.
      const waiter = intakeWaiters.shift();
      if (waiter !== undefined) {
        clearTimeout(waiter.timer);
        nextUnclaimedIntakeIdx = intakePosts.length;
        waiter.resolve(post);
      }
      // Emit the queued response (or sticky). If neither is set, park
      // the stream — a later setIntakeResponse will deliver to it.
      const queued = intakeQueue.shift();
      const next: IntakeResponse | null | undefined =
        queued !== undefined ? queued : stickyIntake;
      if (next === null || next === undefined) {
        parkedIntakeStreams.push(stream);
        const removeFromParked = (): void => {
          const idx = parkedIntakeStreams.indexOf(stream);
          if (idx >= 0) parkedIntakeStreams.splice(idx, 1);
        };
        stream.once("close", removeFromParked);
        stream.once("error", removeFromParked);
        return;
      }
      writeIntakeResponse(stream, next);
      return;
    }
    if (path.startsWith("/_system/response/")) {
      const requestId = path.slice("/_system/response/".length);
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("end", () => {
        const body = Buffer.concat(chunks);
        const pending = pendingResponses.get(requestId);
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          pendingResponses.delete(requestId);
          const sessionIdx = sessionIndex.get(stream.session!) ?? -1;
          pending.resolve({ headers, body, sessionIdx });
        }
        stream.respond({ ":status": 200 });
        stream.end();
      });
      stream.on("error", () => {
        const pending = pendingResponses.get(requestId);
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          pendingResponses.delete(requestId);
          pending.reject(new Error("response stream errored"));
        }
      });
      return;
    }
    // Bridge stream paths (`/_system/ws/{id}` or `/_system/tcp/{id}`):
    // hand off to a registered awaiter, if any. Otherwise return 503.
    if (path.startsWith("/_system/tcp/") || path.startsWith("/_system/ws/")) {
      const waiters = bridgeWaiters.get(path);
      const waiter = waiters?.shift();
      if (waiter !== undefined) {
        clearTimeout(waiter.timer);
        waiter.resolve(stream);
        return;
      }
      stream.respond({ ":status": 503 });
      stream.end();
      return;
    }
    // Unknown path; let the test fail loud.
    stream.respond({ ":status": 404 });
    stream.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  const addr = server.address() as AddressInfo;
  const port = addr.port;

  const fake: FakeH2Server = {
    url: `https://127.0.0.1:${port}`,
    port,
    authority: `127.0.0.1:${port}`,
    setHelloResponse(status, body) {
      helloStatus = status;
      helloBody = body;
      helloFn = null;
    },
    setHelloResponseFn(fn) {
      helloFn = fn;
    },
    setIntakeResponse(response) {
      // One-shot: the next intake POST consumes this response. Tests
      // that need "respond the same way to every intake" should call
      // `setStickyIntakeResponse` instead.
      // If there's a stream already parked (the SDK posted before the
      // response was queued — common in multi-call tests), deliver to
      // that parked stream NOW, mirroring the real tunnel server's
      // "push envelope to whichever pool slot is parked" behavior.
      if (response !== null && parkedIntakeStreams.length > 0) {
        const stream = parkedIntakeStreams.shift()!;
        writeIntakeResponse(stream, response);
        return;
      }
      intakeQueue.push(response);
    },
    setStickyIntakeResponse(response) {
      stickyIntake = response;
    },
    onSessionEvent(cb) {
      sessionEventListeners.push(cb);
    },
    sessionCount() {
      return sessions.size;
    },
    helloCount() {
      return helloCounter;
    },
    injectGoaway(errorCode = http2.constants.NGHTTP2_NO_ERROR) {
      for (const session of sessions) {
        try {
          session.goaway(errorCode);
        } catch {
          /* swallow */
        }
      }
    },
    injectRstStream(streamId, errorCode) {
      // Best-effort; Node doesn't expose direct stream lookup.
      for (const session of sessions) {
        const stream = (
          session as unknown as { _streams?: Record<number, http2.ServerHttp2Stream> }
        )._streams?.[streamId];
        if (stream) {
          stream.close(errorCode);
        }
      }
    },
    receivedHelloHeaders() {
      return receivedHello;
    },
    receivedIntakePosts() {
      return [...intakePosts];
    },
    awaitResponsePost(requestId, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingResponses.delete(requestId);
          reject(new Error(`awaitResponsePost(${requestId}) timed out`));
        }, timeoutMs);
        pendingResponses.set(requestId, { resolve, reject, timer });
      });
    },
    awaitNextIntakePost(timeoutMs = 5000) {
      return new Promise<{ slot: number; ownerToken: string }>(
        (resolve, reject) => {
          // If unclaimed posts already arrived, return immediately.
          if (nextUnclaimedIntakeIdx < intakePosts.length) {
            const post = intakePosts[nextUnclaimedIntakeIdx];
            nextUnclaimedIntakeIdx += 1;
            resolve(post);
            return;
          }
          const waiter: PendingIntakePost = {
            resolve,
            reject,
            timer: setTimeout(() => {
              const idx = intakeWaiters.indexOf(waiter);
              if (idx >= 0) intakeWaiters.splice(idx, 1);
              reject(new Error("awaitNextIntakePost timed out"));
            }, timeoutMs),
          };
          intakeWaiters.push(waiter);
        },
      );
    },
    awaitNextBridgeStream(path, timeoutMs = 5000) {
      return new Promise<http2.ServerHttp2Stream>((resolve, reject) => {
        const list = bridgeWaiters.get(path) ?? [];
        const waiter = {
          resolve,
          reject,
          timer: setTimeout(() => {
            const remaining = bridgeWaiters.get(path) ?? [];
            const idx = remaining.indexOf(waiter);
            if (idx >= 0) remaining.splice(idx, 1);
            reject(
              new Error(`awaitNextBridgeStream(${path}) timed out`),
            );
          }, timeoutMs),
        };
        list.push(waiter);
        bridgeWaiters.set(path, list);
      });
    },
    async close() {
      // Destroy (not graceful close) so a session with a parked, never-
      // ending intake stream can't wedge server.close() on teardown.
      for (const session of sessions) {
        try {
          session.destroy();
        } catch {
          /* swallow */
        }
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
  return fake;
}
