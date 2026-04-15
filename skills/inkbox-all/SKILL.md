---
name: inkbox-all
description: Index of all Inkbox skills in this repository, including the example skills under `examples/`, with GitHub links and short guidance on when to use each one.
user-invocable: false
---

# Inkbox Skills Index

Inkbox is an identity layer for AI agents. It gives agents a persistent identity with a real inbox, phone number, and secure vault, so they can send emails, receive replies, answer calls, store credentials, and manage conversations as a single, consistent entity. Learn more at https://inkbox.ai.

Useful links:

- Website: https://inkbox.ai
- LLMs: https://inkbox.ai/llms.txt
- OpenAPI: https://inkbox.ai/api/openapi.json

This skill is just a directory of the other Inkbox skills in this repository. Use it when you want to see the full menu before choosing a more specific skill. In practice, the SDK skills are the main references for application code, `agent-self-signup` covers the self-registration flow, `inkbox-cli` covers shell usage, and the example skills under `examples/` are prompt templates for browser-capable agents.

## Core Skills

- `agent-self-signup`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/agent-self-signup/SKILL.md
  Shared reference for Inkbox agent self-signup, verification, resend-verification, and claim-status flows.

- `inkbox-cli`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-cli/SKILL.md
  Reference for running the Inkbox CLI (`inkbox` / `@inkbox/cli`) for identities, email, phone, text, vault, mailbox, number, signing key, and webhook operations.

- `inkbox-openclaw`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-openclaw/SKILL.md
  OpenClaw-oriented Inkbox skill for TypeScript usage with environment and dependency setup guidance.

- `inkbox-python`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-python/SKILL.md
  Python SDK reference for `inkbox`, including identities, email, phone, text/SMS, vault, and signing keys.

- `inkbox-ts`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-ts/SKILL.md
  TypeScript/JavaScript SDK reference for `@inkbox/sdk`, including identities, email, phone, text/SMS, vault, and signing keys.

## Example Skills

- `browser-use`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/examples/use-inkbox-browser-use/SKILL.md
  Prompt template for an agent that has Browser Use browser automation plus an Inkbox-backed email identity and vault access.

- `kernel`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/examples/use-inkbox-kernel/SKILL.md
  Prompt template for an agent that has a Kernel cloud browser plus an Inkbox-backed email identity.

## Related Examples

These are example directories in the repo that are useful alongside the skills above:

- `use-inkbox-browser-use`
  GitHub: https://github.com/inkbox-ai/inkbox/tree/main/examples/use-inkbox-browser-use

- `use-inkbox-cli`
  GitHub: https://github.com/inkbox-ai/inkbox/tree/main/examples/use-inkbox-cli

- `use-inkbox-kernel`
  GitHub: https://github.com/inkbox-ai/inkbox/tree/main/examples/use-inkbox-kernel

## How To Choose

- Use `inkbox-python` when writing Python application code against the SDK.
- Use `inkbox-ts` when writing TypeScript or JavaScript application code against the SDK.
- Use `inkbox-cli` when the task is operational and best handled with shell commands.
- Use `agent-self-signup` when the agent does not have an API key yet and needs to self-register.
- Use `inkbox-openclaw` when the environment is specifically OpenClaw.
- Use the example skills when you want a reusable agent prompt rather than SDK integration code.
