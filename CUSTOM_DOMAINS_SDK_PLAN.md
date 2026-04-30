# Plan: SDK + skills support for custom email domains

## Context

The Inkbox mail service recently shipped custom email domains. The backend lives
in `~/servers/` and the user-facing console in `~/console/`. This plan covers
extending the TypeScript and Python SDKs (and updating skill docs) so users can:

1. List domains available to their org.
2. Set the org default domain (admin-scoped API key only).
3. Specify a domain when creating a mailbox.

It is **not** a port of the full domain lifecycle (registration, DNS record
inspection, verification, DKIM rotation, deletion). Those stay console-only for
now — see "Out of scope" at the end.

## Source-of-truth references

### Server (`~/servers/`)
- Routes: `src/apps/api_server/subapps/domains/routes/domain_routes.py`
- Domain contracts: `src/data_models/api_contracts/domains.py`
- Mailbox-create domain resolution: `src/mail/mailbox_create.py` (lines 89–199)
- Standalone mailbox request: `src/data_models/api_contracts/mail/mailbox.py`
  (uses `sending_domain_id`)
- Identity nested-mailbox request: `src/data_models/api_contracts/agent_identity.py:48`
  (uses `sending_domain` — a **bare domain name**, not an id)
- Self-signup contract: `src/data_models/api_contracts/agent_signup.py`
  (no `sending_domain` / `mailbox` sub-object — signup stays on platform domain)

### Console (`~/console/`)
- API client: `src/lib/domain-client.ts`
- Default-domain UI (admin gating): `src/components/domains/default-domain-selector.tsx`
- Domain picker for mailbox creation: `src/components/domains/domain-selector.tsx`
- Types: `src/types/domain.ts`

### Endpoints we will wrap

| Endpoint | Purpose | Auth |
|---|---|---|
| `GET /api/v1/domains` (optional `?status=verified`) | list domains | any API key / JWT |
| `POST /api/v1/domains/{domain_name}/set-default` | set org default; pass the platform sending domain (e.g. `inkboxmail.com` in prod) to clear | **admin-scoped API key** or JWT org admin |
| `POST /api/v1/mail/mailboxes` with `sending_domain_id` | create standalone mailbox on a chosen domain | any API key |
| `POST /api/v1/identities` with `mailbox.sending_domain` | create identity + nested mailbox on a chosen domain | any API key |

Domain-selection semantics (apply to both mailbox-create paths):
- **Omitted** → uses org's verified default, falls back to platform.
- **`null`** → forces platform sending domain, ignoring org default.
- **String value** → must belong to org and be `VERIFIED`. Both paths reject
  with 4xx otherwise; SDK callers should treat this as "pass a verified
  domain name."

The standalone endpoint takes the **id** (`sending_domain_id`); the identity
endpoint takes the **bare domain name** (`sending_domain`). This asymmetry is
intentional on the server and the SDK should mirror it under two distinct
option names rather than papering over it. Magic-string acceptance ("does this
look like an id or a name?") is a worse footgun than two clearly-typed fields.

**Minor error-boundary divergence (informational, not user-facing):** both
paths require `VERIFIED` and 409 otherwise via `resolve_sending_domain`
(`mailbox_create.py:147-155`). The only divergence is the 404 vs 409 boundary
for very-early-lifecycle rows: the identity path's name→id prelookup
(`agent_identity_subapp.py:614-623`) filters on `ownership_validated=True`,
so a not-yet-ownership-validated domain 404s there but would 409 (with a
status payload) via the standalone path. SDK docstrings can say one thing:
"the domain must be a verified custom domain registered to your org."

Both nullable-vs-missing cases must round-trip correctly through the SDK.
Naive `if (opts.sendingDomainId) body.sending_domain_id = ...` collapses `null`
into "omitted" and breaks the explicit-platform case. Use `'sendingDomainId' in opts`
in TS (precedent: `webhookUrl` handling at `sdk/typescript/src/mail/resources/mailboxes.ts:82`).
Use the existing `_UNSET = object()` sentinel pattern in Python (precedent:
`sdk/python/inkbox/mail/resources/mailboxes.py:17,67-69`) — do not introduce a
new `_Unset` type.

## Design

### New `domains` resource — top-level, not under `mail.*`

There is no `mail` namespace on either SDK today. Both expose resources flat:
- TS: `inkbox.mailboxes` at `sdk/typescript/src/inkbox.ts:207`.
- Python: `client.mailboxes` at `sdk/python/inkbox/client.py:193`.

Domains also live at `/api/v1/domains`, **not** `/api/v1/mail/domains`, so they
shouldn't share `mailHttp`. They need their own transport rooted at
`/api/v1/domains` (or reuse the existing `apiHttp` rooted at `/api/v1` and
prefix paths with `/domains`).

**Public surface:**
- TS: `inkbox.domains` (top-level getter on `Inkbox`).
- Python: `client.domains` (top-level property on `Inkbox`).

File layout under `mail/resources/` is fine internally — that's just where the
file lives — but the public accessor is flat. Implementation file paths:
- TS: `sdk/typescript/src/mail/resources/domains.ts` → `DomainsResource`
- Python: `sdk/python/inkbox/mail/resources/domains.py` → `DomainsResource`

Wire-up:
- TS: declare `readonly _domains: DomainsResource` on the class body next to
  `_mailboxes` (`inkbox.ts:109`); build `domainsHttp` rooted at
  `${apiRoot}/domains` in the constructor; assign `this._domains = ...`;
  expose via `get domains(): DomainsResource`. Match the existing
  `_mailboxes` / `_numbers` pattern verbatim — easy to miss the field
  declaration in a tired PR.
- Python: same — build `self._domains_http` in `__init__`, construct
  `self._domains = DomainsResource(self._domains_http)`, expose
  `@property def domains(self)`. **Add `self._domains_http.close()` to
  `client.close()`** (`client.py:182-188`) alongside the other transports;
  forgetting this leaks connection pools.

### Package exports

New types must be added to the public exports or callers can call
`inkbox.domains` but can't import the returned object types.

- TS: `sdk/typescript/src/index.ts` — add `Domain`, `SendingDomainStatus`
  exports alongside `Mailbox` / `IdentityMailbox`. (`SetDefaultResult` is no
  longer needed — see method signatures below.)
- Python: `sdk/python/inkbox/__init__.py` — add `Domain`, `SendingDomainStatus`
  to the existing import block.

Type files: place `Domain` / `SendingDomainStatus` in a new
`mail/types.ts` block (or `mail/domain_types.ts` if cleaner) and the Python
equivalent in `inkbox/mail/types.py`. Co-locating with `Mailbox` is fine
since they're conceptually paired.

### Methods (both SDKs, same shape)

```ts
// TS
inkbox.domains.list(opts?: { status?: SendingDomainStatus }): Promise<Domain[]>
inkbox.domains.setDefault(domainName: string): Promise<string | null>
```

```python
# Python
client.domains.list(*, status: SendingDomainStatus | None = None) -> list[Domain]
client.domains.set_default(domain_name: str) -> str | None
```

`setDefault` returns the bare new default domain (or `null` if the platform
default was reinstated). The server's `SetDefaultResponse` (`domains.py:285-297`)
is a single-field model wrapping `default_domain: str | None` — wrapping it in
an SDK object adds ceremony for one nullable string. If the response shape
ever grows, expand the SDK return type then.

`SendingDomainStatus` is an enum/literal union. Values transplanted verbatim
from `~/servers/src/data_models/sending_domain.py:16-52`:

| Value | Meaning |
|---|---|
| `not_started` | Row exists but no provisioning work has begun. Brief transitional state. |
| `awaiting_ownership` | Waiting for the customer to publish `inkbox-ownership.<domain>` TXT before the upstream mail provider is engaged. |
| `pending` | Ownership confirmed and provider identity provisioned; DNS records issued but haven't propagated. |
| `dns_invalid` | DNS records resolve but values disagree with what we asked the customer to publish. |
| `verifying` | DNS resolves correctly; the upstream mail provider is still verifying. |
| `verified` | Active, healthy, ready to send and receive. |
| `failed` | 72h verification window elapsed without success. Purged after 7 days. |
| `pending_dkim_rotation` | DKIM rotation in flight — new selector in DNS, old key still active upstream. |
| `degraded` | Previously-verified row regressed; one or more required records no longer match. Re-verifies on next poller pass. |
| `pending_deletion` | Customer initiated DELETE; reversible for 24h before hard-delete. |

TS shape — `export enum`, matching the existing convention in
`mail/types.ts` (`FilterMode`, `MessageDirection`, `ForwardMode`,
`ThreadFolder`, `MailRuleAction`, `MailRuleMatchType`, `ContactRuleStatus`
are all enums):

```ts
export enum SendingDomainStatus {
  NOT_STARTED = "not_started",
  AWAITING_OWNERSHIP = "awaiting_ownership",
  PENDING = "pending",
  DNS_INVALID = "dns_invalid",
  VERIFYING = "verifying",
  VERIFIED = "verified",
  FAILED = "failed",
  PENDING_DKIM_ROTATION = "pending_dkim_rotation",
  DEGRADED = "degraded",
  PENDING_DELETION = "pending_deletion",
}
```

Python shape — `StrEnum`, mirroring server:

```python
from enum import StrEnum

class SendingDomainStatus(StrEnum):
    NOT_STARTED = "not_started"
    AWAITING_OWNERSHIP = "awaiting_ownership"
    PENDING = "pending"
    DNS_INVALID = "dns_invalid"
    VERIFYING = "verifying"
    VERIFIED = "verified"
    FAILED = "failed"
    PENDING_DKIM_ROTATION = "pending_dkim_rotation"
    DEGRADED = "degraded"
    PENDING_DELETION = "pending_deletion"
```

Verify against `~/servers/src/data_models/sending_domain.py` at implementation
time in case states have been added since this plan was written.

`setDefault` docstring must call out:
- Pass the **bare domain name** (e.g. `"mail.acme.com"`), not the id.
- Pass the **platform sending domain for the target environment** (e.g.
  `"inkboxmail.com"` in production) to clear the org default and revert to
  the platform domain. The server only clears when the path matches its
  configured platform domain, which varies by env.
- Requires an **admin-scoped API key**. The server returns 403 otherwise — let
  that surface as the SDK's normal auth error; do not pre-check client-side.

### `Domain` SDK type — explicit projection

The server `DomainResponse` (`domains.py:136+`) actually contains:
`id`, `organization_id`, `domain`, `mail_from_subdomain`, `is_default`,
`status`, `failure_reason`, `verified_at`, `last_checked_at`, `dkim_selector`,
`ownership_token`. There are no `created_at` / `updated_at` / `ownership_validated`
fields on the wire (those exist on the ORM model but aren't in the contract).

The SDK exposes a deliberately narrowed projection — explicit allowlist, not
"everything except DKIM/token." Fields:

| SDK field (TS / Python) | Server field | Notes |
|---|---|---|
| `id` | `id` | |
| `domain` | `domain` | bare domain name |
| `status` | `status` | `SendingDomainStatus` |
| `isDefault` / `is_default` | `is_default` | |
| `verifiedAt` / `verified_at` | `verified_at` | nullable |

Excluded: `organization_id` (implied by API key), `mail_from_subdomain`
(always `"mail"` in v1), `dkim_selector` and `ownership_token` (operational
detail), and diagnostic fields `failure_reason` / `last_checked_at` (the
console is where users debug stuck domains; SDK callers don't need them for
sending mail). Start skinny — add fields when callers ask for them.

### Mailbox create signature — standalone

TS — `sdk/typescript/src/mail/resources/mailboxes.ts:48`:
```ts
async create(options: {
  agentHandle: string;
  displayName?: string;
  emailLocalPart?: string;
  sendingDomainId?: string | null;   // NEW — id, omit/null/string semantics
}): Promise<Mailbox>
```

Python — `sdk/python/inkbox/mail/resources/mailboxes.py:40`:
```python
def create(
    self,
    *,
    agent_handle: str,
    display_name: str | None = None,
    email_local_part: str | None = None,
    sending_domain_id: str | None = _UNSET,  # type: ignore[assignment]
) -> Mailbox: ...
```

### Identity create signature — nested mailbox

`POST /v1/identities` carries a `mailbox` sub-object with `sending_domain`
(bare name, not id). This change has three coordinated pieces; missing any one
will leak the field at one layer of the SDK and hide it at another.

**(a) `IdentityMailboxCreateOptions`:**
- TS: `sdk/typescript/src/identities/types.ts:16` — add `sendingDomain?: string | null;`
- Python: `sdk/python/inkbox/identities/types.py:18` — add
  `sending_domain: str | None = _UNSET` (using the same sentinel pattern).

**(b) `to_wire` / `identityMailboxCreateOptionsToWire` — must preserve `null`.**
Widen TS return to `Record<string, unknown>` and Python to `dict[str, Any]`
(matches the dominant idiom — `mailboxes.ts:53`, `identities/types.py:64`).
Gate on presence, not truthiness:
```ts
if ("sendingDomain" in options) body["sending_domain"] = options.sendingDomain;
```
```python
if self.sending_domain is not _UNSET:
    body["sending_domain"] = self.sending_domain
```

**(c) `Inkbox.createIdentity` / `Inkbox.create_identity` high-level helpers.**
This is the actual public API most users call. Currently `inkbox.ts:254-274`
synthesizes the nested mailbox from only `displayName` / `emailLocalPart`,
and `client.py:234-280` does the same. Both also infer "create a mailbox"
when either of those is provided. Without changes here, `IdentityMailboxCreateOptions`
gets a field nobody can pass through the front door.

Required updates:
- TS — `CreateIdentityOptions`: add `sendingDomain?: string | null;` Pass it
  through to the synthesized mailbox object. Update the gate to also imply
  mailbox creation when `"sendingDomain" in options`.
- Python — `create_identity` kwargs: add `sending_domain: str | None = _UNSET`.
  Pass through to `IdentityMailboxCreateOptions`. Update the gate to imply
  mailbox creation when `sending_domain is not _UNSET`.

**Note on `null`:** the gate covers explicit `null` too — a user passing
`sendingDomain: null` is asking for a platform-domain mailbox and that
should imply mailbox creation, exactly as `emailLocalPart: ""` would. The
`"sendingDomain" in options` / `is not _UNSET` checks already do this.

**Do not** add `sendingDomainId` to the identity path. The two paths use
different field names because the server does — keep them aligned.

### Mailbox response — parse `sending_domain`

The mailbox response (`~/servers/src/data_models/api_contracts/mail/mailbox.py:155`)
includes `sending_domain: str` — the bare domain the server actually picked
after default resolution. Callers need this to confirm which domain a mailbox
landed on (especially when they omitted the field and inherited the org
default).

The identity-detail response (`agent_identity.py:235`) types its nested
mailbox as `MailboxResponse | None` — i.e. the same `MailboxResponse` shape
used by the standalone endpoint, so `sending_domain` is on the wire there
too.

Update the SDK types and parsers:
- TS: `sdk/typescript/src/mail/types.ts:169` — add `sending_domain?: string`
  to `RawMailbox`; in `parseMailbox`, set `sendingDomain` to
  `r.sending_domain ?? r.email_address.split("@")[1] ?? ""`. Mirror to the
  exposed `Mailbox` type. The `?` and fallback exist so old test fixtures
  built without `sending_domain` still parse — server responses always
  populate it via `_derive_sending_domain` (`mailbox.py:182`), so the
  fallback is belt-and-suspenders for tests.
- TS: `sdk/typescript/src/identities/types.ts:101,147` — same change to
  `RawIdentityMailbox` and `parseIdentityMailbox`, exposing on
  `IdentityMailbox` (line 38).
- Python: `sdk/python/inkbox/mail/types.py` — add `sending_domain: str` to
  the `Mailbox` dataclass; in `_from_dict`, fall back to
  `d["email_address"].split("@", 1)[1]` when the key is missing.
- Python: `sdk/python/inkbox/identities/types.py:101,118` — same change to
  `IdentityMailbox` and its `_from_dict`.

### Tests

- TS: add unit tests next to existing mailbox/numbers tests covering
  (a) `domains.list()` passes through `?status=`,
  (b) `domains.setDefault()` posts to the right URL and returns the bare
      string-or-null,
  (c) `mailboxes.create()` serializes `sendingDomainId` correctly for the
      three cases: omitted, `null`, string,
  (d) `Inkbox.createIdentity` (the high-level helper, not just
      `identityMailboxCreateOptionsToWire`) serializes `sendingDomain` for
      omitted / null / string and triggers mailbox creation when only
      `sendingDomain` is set,
  (e) `parseMailbox` reads `sending_domain` off the response and falls back
      to `email_address` split when absent (compat for old fixtures),
  (f) `parseIdentityMailbox` reads `sending_domain` with the same fallback.
- Python: parallel tests under `sdk/python/tests/`, including coverage of
  `create_identity(..., sending_domain=...)` round-tripping null/omitted/string.
- No live integration tests — server already has
  `tests/api_integration/test_domains_lifecycle.py`.

## Skill updates

Add a short "Custom email domains" subsection to each skill that documents
mailbox/identity creation. Keep it tight: 5–10 lines, one code sample per
language.

- `skills/inkbox-ts/SKILL.md` — near line 429 (mailbox section). Document
  `inkbox.domains.list()`, `inkbox.domains.setDefault()`, the new
  `sendingDomainId` option on `mailboxes.create()`, and the new `sendingDomain`
  option on identity create. Note admin scope for `setDefault`.
- `skills/inkbox-python/SKILL.md` — parallel section in the mailboxes area.
- `skills/inkbox-openclaw/SKILL.md` — mirrors `inkbox-ts`; copy the same block.
- `skills/inkbox-cli/SKILL.md` — **only update if we ship the CLI changes
  below**. Otherwise skip.
- `skills/inkbox-all/SKILL.md` — index file; no content change unless it lists
  resources, in which case add `domains`.

**Do not update `skills/inkbox-agent-self-signup/SKILL.md`.** The self-signup
contract (`agent_signup.py`) has no `mailbox` sub-object and no
`sending_domain` field — signup is fixed to the platform domain. An earlier
draft of this plan was wrong about that.

## CLI

CLI is out of scope for this work; will be a follow-up if requested. The CLI
currently has no domain commands (`cli/src/commands/mailbox.ts:207`). When
we do it: add `inkbox domain list`, `inkbox domain set-default <name>`,
`--domain <id>` flag on `inkbox mailbox create`, and `--domain <name>` flag
on identity create. Update `skills/inkbox-cli/SKILL.md` line 246.

## Out of scope (console-only for now)

Domain registration (`POST /v1/domains`), DNS record retrieval, force
re-verification, DKIM rotation, soft/hard delete, restore. These are
admin-heavy flows where the console's interactive UI matters; the SDK gains
little by wrapping them now. Easy to add later if requested.

## Suggested PR breakdown

1. **PR 1** — TS + Python `domains` resource (`list`, `setDefault`),
   `Domain` + `SendingDomainStatus` types and exports, `Mailbox.sendingDomain`
   + `IdentityMailbox.sendingDomain` parsing (with fallback), `sendingDomainId`
   on `mailboxes.create()`, `sendingDomain` on `IdentityMailboxCreateOptions`
   **and** on `Inkbox.createIdentity` / `create_identity` helpers,
   null-preserving serializers for the identity path, `_domains_http.close()`
   in Python `client.close()`, plus tests. Folded together because PR 1
   (resource only) is shippable but useless until the mailbox-side wiring
   lands; users can't actually attach a mailbox to a non-default domain
   without it.
2. **PR 2** — Skill doc updates (inkbox-ts, inkbox-python, inkbox-openclaw,
   inkbox-all if applicable).
3. **PR 3 (optional)** — CLI `domain list` / `domain set-default` /
   `--domain` flags + inkbox-cli skill update.

## Resolved design points

- **Identity payload field name**: `sending_domain` (bare domain name), per
  `agent_identity.py:48`. SDK exposes this as `sendingDomain` / `sending_domain`.
- **Standalone mailbox payload field name**: `sending_domain_id` (id), per
  `mail/mailbox.py`. SDK exposes this as `sendingDomainId` / `sending_domain_id`.
- **Public accessor location**: top-level (`inkbox.domains` /
  `client.domains`) — there is no `mail.*` namespace.
- **Transport**: rooted at `/api/v1/domains`, not `/api/v1/mail`.
- **Mailbox response**: `sending_domain` is parsed and exposed on the SDK
  `Mailbox` type so callers can read which domain the server picked.
- **Self-signup**: not updated; signup has no domain selector.
- **Sentinels**: TS uses `'key' in opts` (existing pattern); Python uses the
  existing `_UNSET = object()` sentinel.
- **Typed 409 for `default_domain_unavailable`**: skipped — surface as a
  generic API error.
- **`setDefault` return type**: bare `string | null` / `str | None`, not a
  wrapped `SetDefaultResult` object. Server response has one nullable field;
  ceremony not warranted.
- **Identity-vs-standalone error semantics**: both require `VERIFIED` (both
  paths funnel through `resolve_sending_domain` which 409s otherwise). Only
  divergence is 404 vs 409 boundary for not-yet-`ownership_validated` rows.
  SDK docstrings can say "must be a verified custom domain" for both.
- **Identity-mailbox response shape**: server already includes `sending_domain`
  (typed as `MailboxResponse`) — SDK just needs to parse it on `IdentityMailbox`.
- **High-level identity helpers** (`createIdentity` / `create_identity`):
  must also accept `sendingDomain` / `sending_domain`; presence implies
  mailbox creation, matching how `displayName` / `emailLocalPart` already do.
