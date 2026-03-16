# TypeScript Examples

Runnable examples for the [Inkbox TypeScript SDK](../../sdk/typescript/).

## Setup

```bash
npm install
```

Set your environment variables:

```bash
export INKBOX_API_KEY=ApiKey_...
export INKBOX_AGENT_HANDLE=my-agent
```

## Running examples

```bash
# Email
npx tsx send-email.ts
npx tsx list-emails.ts
npx tsx get-thread.ts
npx tsx search-emails.ts

# Phone
npx tsx place-call.ts
npx tsx list-calls.ts
npx tsx get-transcript.ts
```

Edit the `// --- Configuration ---` block at the top of each file to set your inputs before running.
