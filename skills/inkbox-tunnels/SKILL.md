---
name: inkbox-tunnels
description: Use when bringing a local server online behind a public Inkbox URL via `inkbox.tunnels.connect(...)` — covers tunnel CRUD, edge vs passthrough TLS, URL forwarding, and in-process Fetch/ASGI/WebSocket handlers in both Python and TypeScript SDKs.
user-invocable: false
---

# Inkbox Tunnels

Inkbox Tunnels expose a process running on the developer's machine (or any POSIX host) at a public `https://{name}.tunnel.inkboxwire.com` URL. The SDK opens an outbound HTTP/2 connection to the data plane; inbound third-party traffic rides back over that same connection. No inbound port to open, no static IP needed.

Two TLS modes:

| Mode | Who terminates TLS | When to pick |
|---|---|---|
| `edge` (default) | Inkbox terminates at the edge, forwards plaintext requests as envelopes | Most apps. Simpler. The SDK sees parsed `Request`s / ASGI scopes. |
| `passthrough` | The SDK terminates TLS in your process | When customers must speak directly to your cert (mTLS, custom SNI), or when end-to-end encryption is a hard requirement. |

Both modes accept either a **`forward_to` URL** (proxy to a local HTTP server) or an **in-process callable** (Fetch handler in TS, ASGI app in Python). WebSocket upgrades work on either.

Platform: tunnels require POSIX. CRUD works everywhere; `connect()` raises on Windows.

---

## Python

### Install

```bash
pip install inkbox
```

### Forward to a local URL (edge mode)

```python
from inkbox import Inkbox

with Inkbox(api_key="ApiKey_...") as inkbox:
    listener = inkbox.tunnels.connect(
        name="my-app",
        forward_to="http://127.0.0.1:8080",
    )
    print(listener.public_url)   # https://my-app.tunnel.inkboxwire.com
    listener.wait()              # blocks; Ctrl-C to stop
```

The first call creates the tunnel server-side and prints the connect secret to stderr (TTY-gated). Subsequent calls reuse `~/.inkbox/tunnels/{name}/state.json`.

### Forward to an in-process ASGI app (FastAPI, Starlette, …)

```python
from fastapi import FastAPI
from inkbox import Inkbox

app = FastAPI()

@app.get("/hello")
async def hello():
    return {"message": "hi from inkbox"}

with Inkbox(api_key="ApiKey_...") as inkbox:
    listener = inkbox.tunnels.connect(name="my-app", forward_to=app)
    listener.wait()
```

The runtime drives the ASGI app directly — no socket, no uvicorn needed. WebSocket scopes are supported the same way.

### Passthrough TLS

```python
listener = inkbox.tunnels.connect(
    name="my-app",
    tls_mode="passthrough",
    forward_to="http://127.0.0.1:8080",   # or an ASGI app
)
```

In passthrough mode the SDK auto-generates and signs a certificate via the control plane (stored under `~/.inkbox/tunnels/{name}/`). The third party connects directly to that cert.

### Async usage

```python
import asyncio
from inkbox import Inkbox

async def main():
    with Inkbox(api_key="ApiKey_...") as inkbox:
        listener = inkbox.tunnels.connect(name="my-app", forward_to="http://127.0.0.1:8080")
        try:
            await listener.serve_forever()
        finally:
            await listener.aclose()

asyncio.run(main())
```

`wait()`/`close()` and `serve_forever()`/`aclose()` are mutually exclusive — pick one pair.

### CRUD

```python
inkbox.tunnels.list()                       # list[Tunnel]
inkbox.tunnels.get("tunnel-uuid")
created = inkbox.tunnels.create(name="my-app", tls_mode="edge")
print(created.tunnel.id, created.connect_secret)   # secret returned ONCE — save it
inkbox.tunnels.delete("tunnel-uuid")        # → pending_removal (24h grace)
inkbox.tunnels.restore("tunnel-uuid")       # un-delete during grace
inkbox.tunnels.rotate_secret("tunnel-uuid") # returns RotatedSecret
```

### Common options

| kwarg | default | notes |
|---|---|---|
| `tls_mode` | `"edge"` | or `"passthrough"` (`TLSMode` enum also works) |
| `pool_size` | server-decided | parked-intake pool, 1–32 |
| `state_dir` | `~/.inkbox/tunnels/{name}` | where state + passthrough cert live |
| `on_status` | `None` | callback for `"connecting"` / `"connected"` / `"reconnecting"` / `"closed"` |
| `allow_remote_forwarding` | `False` | bypass loopback-only allowlist for `forward_to` (review SSRF first) |
| `forward_to_verify_tls` | `True` | for `https://` upstream forwards |
| `secret` | from state file | wins over state file; pass after `rotate_secret` |

---

## TypeScript

### Install

```bash
npm install @inkbox/sdk
```

Node ≥ 18, POSIX only. The data-plane subpath imports `node:http2` / `node:tls`, so it's loaded from a separate entry — `@inkbox/sdk` itself stays browser-safe.

### Forward to a local URL (edge mode)

```typescript
import { Inkbox } from "@inkbox/sdk";
import { connect } from "@inkbox/sdk/tunnels/connect";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });

const listener = await connect(inkbox, {
  name: "my-app",
  forwardTo: "http://127.0.0.1:8080",
});
console.log(listener.publicUrl);   // https://my-app.tunnel.inkboxwire.com
await listener.wait();              // until Ctrl-C / SIGTERM
```

### In-process Fetch-API handler

```typescript
import { connect, type InkboxHandler } from "@inkbox/sdk/tunnels/connect";

const handler: InkboxHandler = async (req, ctx) => {
  if (new URL(req.url).pathname === "/hello") {
    return new Response(JSON.stringify({ message: "hi" }), {
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("not found", { status: 404 });
};

const listener = await connect(inkbox, {
  name: "my-app",
  handler,
});
await listener.wait();
```

`req` is a standard Web `Request`; `ctx` exposes `signal`, `forwardedForIp`, `sniHost`, and the read-only envelope.

### In-process WebSocket handler

```typescript
import type { InkboxWsHandler } from "@inkbox/sdk/tunnels/connect";

const wsHandler: InkboxWsHandler = async (ws) => {
  await ws.accept();   // optionally { protocol, headers }
  for await (const msg of ws) {
    await ws.send(typeof msg === "string" ? `echo: ${msg}` : msg);
  }
};

const listener = await connect(inkbox, {
  name: "my-app",
  handler,        // HTTP fallback (any path that isn't a WS upgrade)
  wsHandler,      // every WS upgrade routes here
});
await listener.wait();
```

`wsHandler` requires either `forwardTo` or `handler` to be set as well — non-WS requests need a destination too.

### Passthrough TLS

```typescript
const listener = await connect(inkbox, {
  name: "my-app",
  tlsMode: "passthrough",
  forwardTo: "http://127.0.0.1:8080",   // or pass `handler` / `wsHandler`
});
```

### CRUD

```typescript
await inkbox.tunnels.list();
await inkbox.tunnels.get("tunnel-uuid");
const created = await inkbox.tunnels.create({ tunnelName: "my-app", tlsMode: "edge" });
console.log(created.tunnel.id, created.connectSecret);   // secret returned ONCE
await inkbox.tunnels.delete("tunnel-uuid");
await inkbox.tunnels.restore("tunnel-uuid");
await inkbox.tunnels.rotateSecret("tunnel-uuid");
```

### Common options

| option | default | notes |
|---|---|---|
| `tlsMode` | `"edge"` | or `"passthrough"` |
| `poolSize` | server-decided | 1–32 |
| `stateDir` | `~/.inkbox/tunnels/{name}` | state.json + passthrough cert |
| `onStatus` | — | `"connecting"` / `"connected"` / `"reconnecting"` / `"closed"` |
| `allowRemoteForwarding` | `false` | bypass loopback-only allowlist |
| `forwardToVerifyTls` | `true` | for `https://` upstream forwards |
| `forwardToCaBundle` | — | extra CA(s) for upstream TLS verification |
| `installSignalHandlers` | `true` on main | clean shutdown on SIGINT/SIGTERM |

---

## Operational Notes

- **State dir is sensitive.** It stores the connect secret and (in passthrough) the private key. Default is `0700` under the user's home directory; treat it like an SSH key dir.
- **Secret recovery.** If you lose the state dir but still own the tunnel, call `rotate_secret(id)` and pass `secret=...` on the next `connect()`.
- **TLS mode is fixed at create.** Switching between edge and passthrough requires deleting and recreating the tunnel.
- **Pending removal.** `delete()` sets the tunnel to a 24h grace state; `restore()` un-deletes. By default `connect()` auto-restores; pass `on_pending_removal="error"` (Python) / `onPendingRemoval: "error"` (TS) to fail loudly instead.
- **`forward_to` is loopback-only by default.** Pass `allow_remote_forwarding=True` only after reviewing the SSRF tradeoff.
- **Body caps** apply uniformly across URL forward and in-process handlers (defaults: 50 MiB inbound, 50 MiB response). Configurable per `connect()`.

## Choosing a Dispatch Path

```
                       │  edge       │  passthrough
───────────────────────┼─────────────┼─────────────────
  forward_to URL       │     ✅      │       ✅
  in-process callable  │     ✅      │       ✅
  WebSocket upgrades   │     ✅      │       ✅
```

Pick `forward_to` URL when you already have a process listening on a port (uvicorn, Express, etc.). Pick the in-process callable when you want to skip the local socket entirely — the runtime drives your handler directly.

## See Also

- `inkbox-python` — Python SDK reference (mailbox/phone/vault/etc.)
- `inkbox-ts` — TypeScript SDK reference
- `inkbox-cli` — shell-side workflows
