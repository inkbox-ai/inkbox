---
name: inkbox-tunnels
description: Use when bringing a local server online behind a public Inkbox URL via `inkbox.tunnels.connect(...)` — covers edge vs passthrough TLS, URL forwarding, and in-process Fetch/ASGI/WebSocket handlers in both Python and TypeScript SDKs.
user-invocable: false
---

# Inkbox Tunnels

Inkbox Tunnels expose a process running on the developer's machine (or any POSIX host) at a public `https://{handle}.inkboxwire.com` URL. The SDK opens an outbound HTTP/2 connection to the data plane; inbound third-party traffic rides back over that same connection. No inbound port to open, no static IP needed.

Tunnels are an **identity property**: every agent identity owns exactly one tunnel, and `tunnel_name == agent_handle`. There is no standalone "create tunnel" call — the tunnel is provisioned atomically by `inkbox.createIdentity(...)`. Pre-existing identities created before this rollout already have tunnels (the migration backfilled them).

Two TLS modes:

| Mode | Who terminates TLS | When to pick |
|---|---|---|
| `edge` (default) | Inkbox terminates at the edge, forwards plaintext requests as envelopes | Most apps. Simpler. The SDK sees parsed `Request`s / ASGI scopes. |
| `passthrough` | The SDK terminates TLS in your process | When customers must speak directly to your cert (mTLS, custom SNI), or when end-to-end encryption is a hard requirement. |

Both modes accept either a **`forward_to` URL** (proxy to a local HTTP server) or an **in-process callable** (Fetch handler in TS, ASGI app in Python). WebSocket upgrades work on either.

Platform: tunnels require POSIX. `connect()` raises on Windows; read-only control-plane calls work everywhere.

---

## Authentication

The data plane authenticates with the **same API key** the SDK client was constructed with. Two options:

- **Admin-scoped key** — can connect any tunnel in the org.
- **Identity-scoped key** — only valid for the tunnel attached to its scoped identity.

For a fresh agent bootstrap, mint an identity-scoped key after `createIdentity`:

```python
identity = inkbox.create_identity("my-app")
scoped_key = inkbox.api_keys.create(label="my-app agent", scoped_identity_id=identity.id)
# Hand `scoped_key.api_key` to the agent process. Its `Inkbox(api_key=...)`
# will use it for both REST and the tunnel data plane.
```

The legacy per-tunnel `connect_secret` is gone — there is nothing to print, persist, or rotate per tunnel. To revoke a tunnel's access, revoke the API key.

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
    # Identity (with tunnel) must already exist — create it once:
    inkbox.create_identity("my-app")  # idempotent if you catch HandleUnavailableError

    listener = inkbox.tunnels.connect(
        name="my-app",
        forward_to="http://127.0.0.1:8080",
    )
    print(listener.public_url)   # https://my-app.inkboxwire.com
    listener.wait()              # blocks; Ctrl-C to stop
```

Subsequent runs read `~/.inkbox/tunnels/{name}/state.json` for cached tunnel-id / zone / public-host. The state file no longer holds a secret.

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
inkbox.create_identity(
    "my-app",
    tunnel={"tls_mode": "passthrough"},
)

listener = inkbox.tunnels.connect(
    name="my-app",
    forward_to="http://127.0.0.1:8080",   # or an ASGI app
)
```

The tunnel's `tls_mode` is fixed at create time. In passthrough mode the SDK auto-generates and signs a certificate via the control plane (stored under `~/.inkbox/tunnels/{name}/`). The third party connects directly to that cert.

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

### Control-plane reads + edit

```python
inkbox.tunnels.list()                  # list[Tunnel]
inkbox.tunnels.get("tunnel-uuid")
inkbox.tunnels.update(                 # metadata-only
    "tunnel-uuid",
    metadata={"team": "gtm"},
)
# Passthrough only: sign a CSR
signed = inkbox.tunnels.sign_csr("tunnel-uuid", csr_pem=csr_bytes)
```

There is no `create`, `delete`, `restore`, `force_delete`, or `rotate_secret` here — tunnel lifecycle is owned by `create_identity` / `identity.delete()` (which cascades).

### Common `connect()` options

| kwarg | default | notes |
|---|---|---|
| `pool_size` | server-decided | parked-intake pool, 1–32 |
| `state_dir` | `~/.inkbox/tunnels/{name}` | where state + passthrough cert live |
| `on_status` | `None` | callback for `"connecting"` / `"connected"` / `"reconnecting"` / `"closed"` |
| `allow_remote_forwarding` | `False` | bypass loopback-only allowlist for `forward_to` (review SSRF first) |
| `forward_to_verify_tls` | `True` | for `https://` upstream forwards |

---

## TypeScript

### Install

```bash
npm install @inkbox/sdk
```

Node ≥ 22, POSIX only. The data-plane subpath imports `node:http2` / `node:tls`, so it's loaded from a separate entry — `@inkbox/sdk` itself stays browser-safe.

### Forward to a local URL (edge mode)

```typescript
import { Inkbox } from "@inkbox/sdk";
import { connect } from "@inkbox/sdk/tunnels/connect";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
await inkbox.createIdentity("my-app");  // once; the tunnel is provisioned atomically

const listener = await connect(inkbox, {
  name: "my-app",
  forwardTo: "http://127.0.0.1:8080",
});
console.log(listener.publicUrl);   // https://my-app.inkboxwire.com
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
await inkbox.createIdentity("my-app", {
  tunnel: { tlsMode: "passthrough" },
});

const listener = await connect(inkbox, {
  name: "my-app",
  forwardTo: "http://127.0.0.1:8080",   // or pass `handler` / `wsHandler`
});
```

### Control-plane reads + edit

```typescript
await inkbox.tunnels.list();
await inkbox.tunnels.get("tunnel-uuid");
await inkbox.tunnels.update("tunnel-uuid", {
  metadata: { team: "gtm" },
});
// Passthrough only:
await inkbox.tunnels.signCsr("tunnel-uuid", { csrPem });
```

Tunnels are provisioned atomically by `inkbox.createIdentity(...)`; there is no standalone `create` / `delete` / `restore` / `forceDelete` / `rotateSecret` surface.

### Common `connect()` options

| option | default | notes |
|---|---|---|
| `poolSize` | server-decided | 1–32 |
| `stateDir` | `~/.inkbox/tunnels/{name}` | state.json + passthrough cert |
| `onStatus` | — | `"connecting"` / `"connected"` / `"reconnecting"` / `"closed"` |
| `allowRemoteForwarding` | `false` | bypass loopback-only allowlist |
| `forwardToVerifyTls` | `true` | for `https://` upstream forwards |
| `forwardToCaBundle` | — | extra CA(s) for upstream TLS verification |
| `installSignalHandlers` | `true` on main | clean shutdown on SIGINT/SIGTERM |

---

## Operational Notes

- **State dir is sensitive in passthrough mode.** It stores the per-tunnel private key. Default is `0700` under the user's home directory; treat it like an SSH key dir. Edge mode keeps only zone/public-host caching there.
- **No secret recovery dance.** Data-plane auth is the same API key used for the control plane. Lose the key, mint a new one via `inkbox.api_keys.create(...)` and revoke the old.
- **TLS mode is fixed at create.** Switching between edge and passthrough requires `identity.delete()` (cascades to the tunnel) + recreating the identity with the desired `tunnel.tls_mode`.
- **Identity-delete cascades.** Deleting an identity removes its tunnel and revokes its scoped API keys.
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
