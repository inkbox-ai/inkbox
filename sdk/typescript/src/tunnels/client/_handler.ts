/**
 * inkbox-tunnels/client/_handler.ts
 *
 * In-process Fetch-API HTTP handler. The user supplies a
 * `(req: Request, ctx: InkboxRequestContext) => Response | Promise<Response>`
 * function; the runtime synthesizes a `Request` from the envelope,
 * invokes the handler, reads the response with the same per-chunk size
 * cap as the URL-forward path, and returns a discriminated union the
 * runtime maps onto fixed on-wire response shapes.
 *
 * Mirrors Python `_asgi.py` semantics at the wire level. The TS-side
 * shape is Web standards (Fetch API) instead of ASGI 3.0.
 */

import type { Envelope, ReadonlyEnvelope } from "./_envelope.js";
import { HOP_BY_HOP_RESPONSE } from "./_protocol.js";

export interface InkboxRequestContext {
  /**
   * Tripped when the runtime's deadline expires. Plumbed through to
   * the handler so user code can react cooperatively.
   */
  signal: AbortSignal;
  /**
   * Best-effort original client IP (from the inkbox forwarded-for
   * meta header). null when not advertised by the server.
   */
  forwardedForIp: string | null;
  /** SNI host as observed at the public ingress, when available. */
  sniHost: string | null;
  /**
   * Read-only access to the parsed envelope for callers that need
   * metadata not exposed elsewhere on the context. Escape hatch only;
   * prefer the typed fields above.
   */
  envelope: ReadonlyEnvelope;
}

export type InkboxHandler = (
  req: Request,
  ctx: InkboxRequestContext,
) => Response | Promise<Response>;

export type InProcessHttpResult =
  | {
      kind: "ok";
      status: number;
      headers: Array<[string, string]>;
      body: Buffer;
    }
  | {
      kind: "too-large";
      status: 502;
      inkboxReason: "response-too-large";
    }
  | {
      kind: "handler-error";
      status: 502;
      inkboxReason: "handler-error";
    };

export interface DispatchHttpInProcessOpts {
  envelope: Envelope;
  handler: InkboxHandler;
  publicHost: string;
  maxResponseBytes: number;
  signal: AbortSignal;
}

/**
 * Synthesize a `Request` from the envelope, invoke the handler, read
 * back the response under the size cap.
 */
export async function dispatchHttpInProcess(
  opts: DispatchHttpInProcessOpts,
): Promise<InProcessHttpResult> {
  const { envelope, handler, publicHost, maxResponseBytes, signal } = opts;
  const url = `https://${publicHost}${envelope.path}`;
  const reqHeaders = new Headers();
  reqHeaders.set("host", publicHost);
  reqHeaders.set("x-forwarded-host", publicHost);
  reqHeaders.set("x-forwarded-proto", "https");
  if (envelope.forwardedForIp !== null) {
    reqHeaders.set("x-forwarded-for", envelope.forwardedForIp);
    reqHeaders.set("forwarded", `for=${envelope.forwardedForIp}`);
  }
  for (const [k, v] of envelope.forwardedHeaders) {
    const kl = k.toLowerCase();
    if (
      kl === "host" ||
      kl === "x-forwarded-host" ||
      kl === "x-forwarded-proto" ||
      kl === "x-forwarded-for" ||
      kl === "forwarded"
    ) {
      continue;
    }
    reqHeaders.append(k, v);
  }

  const reqInit: RequestInit = {
    method: envelope.method,
    headers: reqHeaders,
    body:
      envelope.method === "GET" || envelope.method === "HEAD"
        ? undefined
        : envelope.body.length > 0
          ? new Uint8Array(envelope.body)
          : undefined,
    signal,
    // Discourage the user from issuing duplex calls when not needed.
  };

  let request: Request;
  try {
    request = new Request(url, reqInit);
  } catch {
    return {
      kind: "handler-error",
      status: 502,
      inkboxReason: "handler-error",
    };
  }

  const ctx: InkboxRequestContext = {
    signal,
    forwardedForIp: envelope.forwardedForIp,
    sniHost: envelope.sniHost,
    envelope: envelope as ReadonlyEnvelope,
  };

  let response: Response;
  try {
    response = await handler(request, ctx);
  } catch {
    return { kind: "handler-error", status: 502, inkboxReason: "handler-error" };
  }

  const headers: Array<[string, string]> = [];
  response.headers.forEach((value, key) => {
    if (HOP_BY_HOP_RESPONSE.has(key.toLowerCase())) return;
    headers.push([key, value]);
  });

  const reader = response.body?.getReader();
  if (!reader) {
    return {
      kind: "ok",
      status: response.status,
      headers,
      body: Buffer.alloc(0),
    };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      if (total + chunk.length > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        return {
          kind: "too-large",
          status: 502,
          inkboxReason: "response-too-large",
        };
      }
      chunks.push(chunk);
      total += chunk.length;
    }
  } catch {
    return { kind: "handler-error", status: 502, inkboxReason: "handler-error" };
  }
  return {
    kind: "ok",
    status: response.status,
    headers,
    body: chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, total),
  };
}
