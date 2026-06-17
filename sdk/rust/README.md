# inkbox — Rust SDK

Rust SDK for the [Inkbox](https://inkbox.ai) API — email, SMS/MMS, iMessage,
voice, contacts, notes, an encrypted vault, and inbound tunnels for AI agents.

This crate is a faithful port of the [Python](../python) (`inkbox` on PyPI) and
[TypeScript](../typescript) (`@inkbox/sdk` on npm) SDKs. The public surface is
**blocking** (built on `reqwest::blocking`), matching the synchronous Python/TS
APIs. JSON field names, enum values, request bodies, query params, and paths
match the other SDKs exactly — they all speak to the same server.

## Install

```toml
[dependencies]
inkbox = "0.4"
```

The tunnels data-plane runtime is behind an optional feature:

```toml
[dependencies]
inkbox = { version = "0.4", features = ["tunnels-runtime"] }
```

## Quickstart

```rust
use inkbox::Inkbox;

fn main() -> inkbox::Result<()> {
    // The client is handed out as an `Arc<Inkbox>` (the per-identity facade
    // and the tunnels resource hold a back-reference to it).
    let inkbox = Inkbox::new("ApiKey_...")?;

    // Create an agent identity (atomically provisions a mailbox + tunnel).
    let identity = inkbox.create_identity("support-bot")?;

    // Send an email from the identity's mailbox.
    identity.send_email(
        &["customer@example.com".into()],
        "Hello!",
        Some("Hi there"),
        None, None, None, None, None,
    )?;

    // Read the inbox.
    for msg in identity.iter_emails(None, None)? {
        println!("{:?}", msg.subject);
    }
    Ok(())
}
```

### Advanced construction

```rust
use inkbox::Inkbox;

let inkbox = Inkbox::builder("ApiKey_...")
    .base_url("https://inkbox.ai")  // self-hosting / tests (HTTPS, or localhost over HTTP)
    .timeout_secs(30.0)
    .vault_key("my-Vault-key-01!")  // unlock the vault at construction
    .build()?;
```

### Vault credentials

```rust
let inkbox = Inkbox::builder("ApiKey_...").vault_key("my-Vault-key-01!").build()?;
let identity = inkbox.get_identity("support-bot")?;

for login in identity.credentials()?.list_logins() {
    println!("{}", login.name);
}
```

## Surface

Org-level accessors on `Inkbox` mirror the Python `@property` names:

| Domain | Accessor |
|---|---|
| Mail | `mailboxes()`, `messages()`, `threads()`, `mail_contact_rules()`, `domains()` |
| Phone | `calls()`, `phone_numbers()`, `texts()`, `transcripts()`, `phone_contact_rules()`, `sms_opt_ins()` |
| iMessage | `imessages()`, `imessage_contact_rules()` |
| Vault / data | `vault()`, `contacts()`, `notes()` |
| Org | `api_keys()`, `identities()`, `tunnels()`, `webhooks()` |

The per-identity facade `AgentIdentity` (from `create_identity` / `get_identity`)
exposes channel-scoped convenience methods: `send_email`, `forward_email`,
`iter_emails`, `place_call`, `send_text`, `send_imessage`, `credentials`,
`create_secret`, `set_totp`, and more.

Static (no-client) helpers for the public agent-signup flow live on `Inkbox`:
`Inkbox::signup`, `verify_signup`, `resend_signup_verification`,
`get_signup_status`.

## Crypto

The vault uses Argon2id key derivation and AES-256-GCM envelope encryption,
with the exact parameters of the Python/TS SDKs, so secrets are
cross-SDK-interoperable. TOTP (SHA-1/256/512) and webhook HMAC-SHA256
signature verification (`signing_keys::verify_webhook`) are implemented in
pure Rust.

## Features

- `tunnels-runtime` — the local TLS-terminating HTTP/2 reverse-proxy data plane
  for inbound tunnels (pulls in `tokio`, `rustls` (ring), `h2`). The control-plane
  tunnels surface (`inkbox.tunnels()`: list / get / update / sign_csr) is always
  available without this feature.

## Status

Feature-complete against the Python and TypeScript SDKs. The full REST
surface, vault crypto + TOTP, webhook verification, and the tunnels control
plane are implemented and tested. The tunnels **data-plane runtime**
(`tunnels-runtime` feature) is implemented end-to-end:

- Edge HTTP: TLS h2 dial, `/_system/hello`, parked intake pool, body
  materialization, URL-forward, `/_system/response/{id}`, PING keepalive,
  jittered reconnect.
- WebSocket upgrade bridge and raw-TCP passthrough bridge over h2 extended
  CONNECT, with local upstream WS handshake and rustls TLS termination.
- Passthrough bootstrap: EC P-256 keypair + PKCS#10 CSR signing + cert-chain
  persistence.

61 unit/integration tests cover the wire codecs, crypto, CSR, URL-forward, and
runtime lifecycle. The bidirectional bridge **pumps compile and follow the
Python control flow but have not been exercised against a live edge** in this
repo — run them against a real tunnel to validate end-to-end. See
`src/tunnels/client/`.

## License

MIT
