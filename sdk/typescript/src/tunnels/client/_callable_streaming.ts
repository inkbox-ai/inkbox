/**
 * inkbox-tunnels/client/_callable_streaming.ts
 *
 * Streaming wrapper for `InkboxHandler` used by `CallableDispatch` in
 * passthrough mode. The Fetch-style handler returns a `Response`; this
 * module pipes that response back through `DispatchResponseSink` so
 * the third party gets a true streamed reply.
 *
 * WebSocket upgrades are handled separately by
 * `_ws_passthrough.bridgeWsHandlerOverSink` — the h1 parser and h2
 * transcoder route `isWebSocket=true` requests directly to
 * `CallableDispatch.dispatchWebSocket` so they never reach this
 * HTTP-only invoker.
 */

import type {
  DispatchRequest,
  DispatchResponseSink,
} from "./_dispatch.js";
import type { InkboxHandler, InkboxRequestContext } from "./_handler.js";
import type { ReadonlyEnvelope } from "./_envelope.js";
import { HOP_BY_HOP_RESPONSE } from "./_protocol.js";

export interface InvokeHandlerOpts {
  handler: InkboxHandler;
  request: DispatchRequest;
  response: DispatchResponseSink;
  publicHost: string;
  maxOutboundBodyBytes: number;
}

/**
 * Build a minimal envelope-shaped object for the InkboxRequestContext.
 * Passthrough callable dispatch doesn't have a true envelope (those
 * are produced by the tunnel server's intake path), so we synthesize a
 * placeholder. The handler can read the typed fields directly via
 * `req` / `ctx` instead of poking at this for normal use.
 */
function synthesizeEnvelope(req: DispatchRequest): ReadonlyEnvelope {
  return Object.freeze({
    requestId: "",
    method: req.method,
    path: req.path,
    routeKind: "webhook" as const,
    wsId: null,
    forwardedHeaders: req.headers,
    body: Buffer.alloc(0),
    bodyUri: null,
    forwardedForIp: req.forwardedForIp,
    tcpId: null,
    sniHost: req.sniHost,
    extraMeta: {},
  });
}

async function bodyToReadable(
  iter: AsyncIterable<Buffer>,
): Promise<ReadableStream<Uint8Array> | null> {
  const it = iter[Symbol.asyncIterator]();
  let probed = await it.next();
  if (probed.done) return null;
  const first = probed.value;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(new Uint8Array(first));
      try {
        while (true) {
          const r = await it.next();
          if (r.done) break;
          controller.enqueue(new Uint8Array(r.value));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

export async function invokeHandlerStreaming(
  opts: InvokeHandlerOpts,
): Promise<void> {
  const { handler, request, response, publicHost, maxOutboundBodyBytes } =
    opts;

  // Build a Fetch Request from the DispatchRequest. Headers are flat,
  // method/path provided. URL host is the public host.
  const headers = new Headers();
  for (const [k, v] of request.headers) {
    if (k.startsWith(":")) continue;
    try {
      headers.append(k, v);
    } catch {
      /* invalid header value — skip */
    }
  }
  if (!headers.has("host")) headers.set("host", publicHost);
  if (!headers.has("x-forwarded-host")) headers.set("x-forwarded-host", publicHost);
  if (!headers.has("x-forwarded-proto")) headers.set("x-forwarded-proto", "https");
  if (request.forwardedForIp != null) {
    if (!headers.has("x-forwarded-for"))
      headers.set("x-forwarded-for", request.forwardedForIp);
  }

  const url = `https://${publicHost}${request.path.startsWith("/") ? "" : "/"}${request.path}`;

  const bodyStream =
    request.method === "GET" || request.method === "HEAD"
      ? null
      : await bodyToReadable(request.body);

  const fetchReq = new Request(url, {
    method: request.method,
    headers,
    body: bodyStream as BodyInit | null,
    // Required when sending a stream body on Node fetch.
    duplex: "half",
  } as RequestInit & { duplex?: "half" });

  const ctx: InkboxRequestContext = {
    signal: new AbortController().signal,
    forwardedForIp: request.forwardedForIp,
    sniHost: request.sniHost,
    envelope: synthesizeEnvelope(request),
  };

  let resp: Response;
  try {
    resp = await handler(fetchReq, ctx);
  } catch {
    await response.sendHead({
      status: 502,
      headers: [["content-type", "text/plain"]],
    });
    await response.sendBody(Buffer.from("upstream error"));
    await response.endBody();
    return;
  }

  const respHeaders: Array<[string, string]> = [];
  resp.headers.forEach((value, key) => {
    if (HOP_BY_HOP_RESPONSE.has(key.toLowerCase())) return;
    respHeaders.push([key, value]);
  });

  await response.sendHead({ status: resp.status, headers: respHeaders });
  if (resp.body == null) {
    await response.endBody();
    return;
  }

  let bytesOut = 0;
  const reader = resp.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      bytesOut += buf.length;
      if (bytesOut > maxOutboundBodyBytes) {
        await response.reset("response-too-large");
        return;
      }
      await response.sendBody(buf);
    }
    await response.endBody();
  } catch {
    await response.reset("upstream-error");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* swallow */
    }
  }
}
