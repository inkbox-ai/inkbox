# use-inkbox-signup

Agent self-signup example — register without a pre-existing API key, verify with a human approval code, check restrictions, send a welcome email, and clean up.

No Inkbox account or API key is required to start. The flow provisions a mailbox, identity, and one-time API key in a single call, then sends a verification email to the specified human.

## Prerequisites

1. Python ≥ 3.11 (for the Python script) or Node.js ≥ 22 (for TypeScript)
2. A human email address (`INKBOX_HUMAN_EMAIL`) — receives the 6-digit verification code
3. After registration, save the one-time `INKBOX_API_KEY` from the output

## Flow

| Step | Command | Auth required |
|------|---------|---------------|
| 1. Register | `register` | None |
| 2. Check status | `status` | Signup API key |
| 3. Verify | `verify` | Signup API key + 6-digit code from email |
| 4. Send welcome | `send-welcome` | Signup API key (after verify) |
| 5. Clean up | `cleanup` | Signup API key |

While unclaimed, outbound email is restricted to the human email only (max 10 sends/day). After verification, restrictions lift.

## Run (Python)

```bash
cp .env.example .env
# edit .env — set INKBOX_HUMAN_EMAIL at minimum

cd ../../sdk/python
uv run --env-file ../../examples/use-inkbox-signup/.env \
  python ../../examples/use-inkbox-signup/agent_signup.py register

# Save the printed API key into .env as INKBOX_API_KEY, then:
uv run --env-file ../../examples/use-inkbox-signup/.env \
  python ../../examples/use-inkbox-signup/agent_signup.py status

# After the human shares the 6-digit code:
uv run --env-file ../../examples/use-inkbox-signup/.env \
  python ../../examples/use-inkbox-signup/agent_signup.py verify --code 483921

uv run --env-file ../../examples/use-inkbox-signup/.env \
  python ../../examples/use-inkbox-signup/agent_signup.py send-welcome

uv run --env-file ../../examples/use-inkbox-signup/.env \
  python ../../examples/use-inkbox-signup/agent_signup.py cleanup
```

Other subcommands: `resend` (5-minute cooldown).

## Run (TypeScript)

```bash
cp .env.example .env
# edit .env — set INKBOX_HUMAN_EMAIL at minimum

cd ../../sdk/typescript
npm run build
cd ../../examples/use-inkbox-signup
npm install ../../sdk/typescript

npx tsx --env-file .env agent-signup.ts register
# Save the API key, then continue with status / verify / send-welcome / cleanup
npx tsx --env-file .env agent-signup.ts status
npx tsx --env-file .env agent-signup.ts verify --code 483921
npx tsx --env-file .env agent-signup.ts send-welcome
npx tsx --env-file .env agent-signup.ts cleanup
```

## Restrictions (unclaimed vs claimed)

| | Unclaimed | Claimed (after verify) |
|---|---|---|
| Max sends/day | 10 | 500 |
| Allowed recipients | `human_email` only | No restriction |
| Can receive email | Yes | Yes |

See [`skills/inkbox-agent-self-signup/SKILL.md`](../../skills/inkbox-agent-self-signup/SKILL.md) for the full reference.
