# use-inkbox-vault

Vault TOTP example — create a login credential with TOTP, generate one-time codes, and clean up.

Uses the public TOTP challenge at [authenticationtest.com/totpChallenge](https://authenticationtest.com/totpChallenge/).

## Prerequisites

1. An Inkbox API key (`INKBOX_API_KEY`)
2. A vault key (`INKBOX_VAULT_KEY`) — the vault must be initialized from the [console](https://inkbox.ai/console) first

## Run (Python)

```bash
cd sdk/python
uv run --env-file ../../.env python ../../examples/use-inkbox-vault/agent_totp.py
```

## Run (TypeScript)

```bash
cd sdk/typescript
npm run build
cd ../../examples/use-inkbox-vault
npm install ../../sdk/typescript
npx tsx --env-file ../../.env agent-totp.ts
```
