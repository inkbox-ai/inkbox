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
- Contracts: `src/data_models/api_contracts/domains.py`
- Mailbox-create domain resolution: `src/mail/mailbox_create.py` (lines 89–199)
- Mailbox-create request: `src/data_models/api_contracts/mail/mailbox.py`

### Console (`~/console/`)
- API client: `src/lib/domain-client.ts`
- Default-domain UI (admin gating): `src/components/domains/default-domain-selector.tsx`
- Domain picker for mailbox creation: `src/components/domains/domain-selector.tsx`
- Types: `src/types/domain.ts`

### Endpoints we will wrap

| Endpoint | Purpose | Auth |
|---|---|---|
| `GET /v1/domains` (optional `?status=verified`) | list domains | any API key / JWT |
| `POST /v1/domains/{domain_name}/set-default` | set org default; pass `inkboxmail.com` to clear | **admin-scoped API key** or JWT org admin |
| `POST /v1/mail/mailboxes` with `sending_domain_id` | create mailbox on a chosen domain | any API key |

Mailbox `sending_domain_id` semantics (from `mailbox_create.py`):
- **Omitted** → uses org's verified default, falls back to platform.
- **`null`** → forces platform domain (`inkboxmail.com`), ignoring org default.
- **String id** → must belong to org and be verified, else 404/409.

Note both nullable-vs-missing cases must round-trip correctly through the SDK.
Naive `if (opts.sendingDomainId) body.sending_domain_id = ...` collapses `null`
into "omitted" and breaks the explicit-platform case. Use `'sendingDomainId' in opts`
in TS and a sentinel (e.g. module-level `UNSET`) in Python.

## Design

### New `domains` resource

TS: `sdk/typescript/src/mail/resources/domains.ts` → `DomainsResource`
Python: `sdk/python/inkbox/mail/resources/domains.py` → `DomainsResource`

Place it under `mail/` since they are *sending* domains used by mail. Mirrors
how `numbers` lives under `phone/`.

Wire-up:
- TS: register on `Inkbox` class in `sdk/typescript/src/inkbox.ts` (constructor
  alongside `_mailboxes`, expose via `mail.domains` getter — match how
  `mail.mailboxes` is exposed).
- Python: register in `sdk/python/inkbox/client.py` alongside `_mailboxes`,
  expose via `client.mail.domains` property.

Verify the exact `mail.*` accessor naming when implementing — both SDKs already
expose mailboxes through a mail namespace; reuse it.

### Methods (both SDKs, same shape)

```ts
// TS
mail.domains.list(opts?: { status?: SendingDomainStatus }): Promise<Domain[]>
mail.domains.setDefault(domainName: string): Promise<{ defaultDomain: string | null }>
```

```python
# Python
client.mail.domains.list(*, status: SendingDomainStatus | None = None) -> list[Domain]
client.mail.domains.set_default(domain_name: str) -> SetDefaultResult
```

`Domain` type mirrors server `DomainResponse`: `id`, `domain`, `status`,
`isDefault`/`is_default`, `ownershipValidated`, `verifiedAt`, timestamps. Skip
DKIM / token / KMS fields — they aren't useful for SDK callers and the server
already excludes private key material.

`SendingDomainStatus` is an enum/literal union of server statuses. Take the
list directly from `src/data_models/sending_domain.py` to avoid drift.

`setDefault` docstring must call out:
- Pass the **bare domain name** (e.g. `"mail.acme.com"`), not the id.
- Pass `"inkboxmail.com"` (or whatever `EnvConfig.SES_SENDING_DOMAIN` is) to
  clear and revert to platform default.
- Requires an **admin-scoped API key**. The server returns 403 otherwise — let
  that surface as the SDK's normal auth error; do not pre-check client-side.

### Mailbox create signature change

TS — `sdk/typescript/src/mail/resources/mailboxes.ts:48`:
```ts
async create(options: {
  agentHandle: string;
  displayName?: string;
  emailLocalPart?: string;
  sendingDomainId?: string | null;   // NEW
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
    sending_domain_id: str | None | _Unset = UNSET,  # NEW
) -> Mailbox: ...
```

Also update the `IdentityMailboxCreateOptions` types used by the agent-signup
flow (`sdk/typescript/src/identities/types.ts:16` and
`sdk/python/inkbox/identities/types.py:18`) and any internal call sites that
forward to mailbox create. Verify whether the identity endpoint takes
`sending_domain_id` or `sending_domain` (console uses the latter for identity
mailbox payload — line 36–45 of `domain-selector.tsx`); align with whatever
the server actually accepts at `POST /v1/identities`.

### Tests

- TS: add unit tests next to existing mailbox/numbers tests covering (a) list
  passes through `?status=`, (b) `setDefault` posts to the right URL, (c)
  mailbox create serializes `sendingDomainId` correctly for the three cases:
  omitted, `null`, string.
- Python: parallel tests under `sdk/python/tests/`.
- No live integration tests — the server already has
  `tests/api_integration/test_domains_lifecycle.py`.

## Skill updates

Add a short "Custom email domains" subsection to each skill that documents
mailbox creation. Keep it tight: 5–10 lines, one code sample per language.

- `skills/inkbox-ts/SKILL.md` — near line 429 (mailbox section). Document
  `mail.domains.list()`, `mail.domains.setDefault()`, and the new
  `sendingDomainId` option on `mailboxes.create()`. Note admin scope for
  `setDefault`.
- `skills/inkbox-python/SKILL.md` — parallel section in the mailboxes area.
- `skills/inkbox-openclaw/SKILL.md` — mirrors `inkbox-ts`; copy the same block.
- `skills/inkbox-agent-self-signup/SKILL.md` — only mention the
  `sending_domain_id` / `sendingDomainId` field on the mailbox sub-object;
  don't document `list`/`setDefault` here (signup flow doesn't need them).
- `skills/inkbox-cli/SKILL.md` — **only update if we ship the CLI changes
  below**. Otherwise skip.
- `skills/inkbox-all/SKILL.md` — index file; no content change unless it lists
  resources, in which case add `domains`.

## CLI (open question — recommend deferring)

The CLI currently has no domain commands (`cli/src/commands/mailbox.ts:207`).
Adding them is straightforward but out of the user's stated scope. Suggest:

- **Defer**: ship SDK + skills now; do CLI in a follow-up.
- **If we do it**: add `inkbox domain list`, `inkbox domain set-default <name>`,
  and `--domain <id>` flag on `inkbox mailbox create`. Update
  `skills/inkbox-cli/SKILL.md` line 246.

Will confirm before touching CLI.

## Out of scope (console-only for now)

Domain registration (`POST /v1/domains`), DNS record retrieval, force
re-verification, DKIM rotation, soft/hard delete, restore. These are
admin-heavy flows where the console's interactive UI matters; the SDK gains
little by wrapping them now. Easy to add later if requested.

## Suggested PR breakdown

1. **PR 1** — TS + Python `domains` resource (`list`, `setDefault`) + types +
   tests. No mailbox change yet.
2. **PR 2** — `sendingDomainId` / `sending_domain_id` on mailbox create
   (both SDKs) + identity mailbox options + tests.
3. **PR 3** — Skill doc updates.
4. **PR 4 (optional)** — CLI `domain list` / `domain set-default` /
   `--domain` flag.

Splitting (1) and (2) keeps each PR small and lets the domains resource ship
even if the mailbox-side change needs revision.

## Open questions to resolve before coding

1. Identity mailbox payload field: is it `sending_domain` (string name, per
   console) or `sending_domain_id` (per standalone mailbox)? Confirm against
   `~/servers/src/apps/api_server/subapps/identities/`.
2. Confirm the exact `mail.*` accessor on each SDK (is it `client.mail.mailboxes`
   or `client.mailboxes`?) so the new `domains` resource lands in the right place.
3. Do we want a typed error for the 409 `default_domain_unavailable` case on
   mailbox create, or let it surface as a generic API error? (Lean: generic.)
