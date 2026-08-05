---
name: inkbox-setup
description: Connect the Inkbox MCP server bundled with this plugin, and confirm the connection is working. Use when Inkbox tools are missing, unauthorized, or acting as the wrong identity.
---

# Connect Inkbox

This plugin bundles the Inkbox MCP server alongside its skills. The skills work
on their own, but the tools (`inkbox_email_send`, `inkbox_text_send`, and the
rest) only appear once the server is connected and authorized.

## Before connecting

The user needs an Inkbox account and at least one **identity**. An identity is
the agent's own presence: a handle, an email address, and optionally a phone
number. Creating one provisions its mailbox automatically.

If they have no account or no identity yet, send them to
<https://inkbox.ai/console> first. The Free plan includes three identities.

## Connect

1. Run `/mcp` and choose the `inkbox` server.
2. Claude Code opens a browser for authorization. The user signs in.
3. The consent page asks for two choices:
   - **Organization** — which organization to act in.
   - **Identity** — which identity the assistant becomes.
4. Approving returns to Claude Code with the connection established.

The identity choice is required and it is the important one. Every tool call is
scoped to that identity alone: its mail, its messages, its contacts, its notes.
Other identities in the same organization are not reachable from the connection,
so picking the wrong one looks like missing data rather than an error.

To act as a different identity, disconnect and reconnect, choosing the other
identity at step 3.

## Confirm it worked

Call `inkbox_identity_get`. It returns the identity the connection is bound to.
If the handle is not the one the user expected, reconnect and choose again.

`inkbox_channel_status_get` reports which channels are ready — email, SMS,
iMessage, and sending domains — and is the fastest way to explain why a send
would fail before attempting it.

## When something is missing

**No Inkbox tools at all.** The server is not connected. Run `/mcp` and check
whether `inkbox` is listed as connected; reconnect if not.

**Tools return an authorization error.** The connection was revoked or expired.
Reconnect through `/mcp`.

**The consent page offers no identities.** The organization has none yet. Create
one at <https://inkbox.ai/console>, then reconnect.

**Email works but SMS tools fail.** The identity has no phone number. Numbers
start on the Developer plan; the Free plan includes none. iMessage is available
without a dedicated number.

**A send is refused for a specific recipient.** Inkbox enforces per-identity
contact rules and, for SMS, recipient consent. `inkbox_contact_rules_list` shows
the rules in force, and `inkbox_sms_consent_get` reports whether a recipient can
currently be messaged.

## What this connection does not do

Inkbox acts only when invoked. It does not watch the inbox in the background,
wake the model when a message arrives, or send anything on its own. Handling
incoming communications automatically needs a separate process that receives
webhooks and then invokes the model.

Voice is not part of this connector: it cannot place, answer, or end calls, and
it generates no audio. The call tools are read-only, covering history and text
transcripts of calls that already took place.

## Reference

- Plugin and skills: <https://inkbox.ai/docs/plugins/claude-code>
- MCP server: <https://inkbox.ai/docs/mcp>
- Identities: <https://inkbox.ai/docs/capabilities/identities>
