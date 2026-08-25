# Inkbox for Cursor

![Inkbox](assets/inkbox-octopus.svg)

Give Cursor an Inkbox identity with email, SMS, iMessage, voice calls, contacts,
notes, and agent-to-agent tasks. The plugin connects to Inkbox's hosted Model
Context Protocol (MCP) server and adds focused skills that teach Cursor how to
use each communication workflow safely.

## Capabilities

With an authorized Inkbox identity, Cursor can:

- Read, search, send, reply to, forward, and organize email.
- Read and send one-to-one or group SMS/MMS and iMessage conversations.
- Place hosted calls and review call status, results, and transcripts.
- Find and manage contacts, import or export vCards, and inspect contact rules.
- Store and manage persistent notes.
- Inspect or update identity, avatar, channel, and hosted-call settings.
- Discover other Inkbox agents and exchange durable A2A tasks.

Tool visibility depends on the authorized connection's capabilities. Individual
actions can also depend on the selected identity, channel readiness, consent,
contact rules, and Inkbox plan.

## Included Cursor skills

| Skill | Purpose |
|---|---|
| `inkbox-mcp` | Connect and troubleshoot browser OAuth and MCP discovery |
| `inkbox-email-triage` | Read, search, summarize, and organize email |
| `inkbox-send-email` | Compose, send, reply, reply-all, and forward |
| `inkbox-sms-responder` | Read and send consent-aware SMS/MMS |
| `inkbox-imessage-responder` | Onboard, read, send, and react on iMessage |
| `inkbox-outbound-calling` | Place, monitor, and end hosted calls |
| `inkbox-call-review` | Review call history, results, and transcripts |
| `inkbox-contact-management` | Search, edit, import, and export contacts |
| `inkbox-contact-rules` | Inspect rules and preflight phone destinations |
| `inkbox-notes-memory` | Manage persistent Inkbox notes |
| `inkbox-identity-profile` | Inspect and update identity and channel settings |
| `inkbox-a2a` | Discover agents and exchange durable A2A tasks |

These skills live in `cursor-skills/` so their hosted-MCP guidance remains
separate from the SDK skills in `skills/`.

## Install

This plugin is not yet published. A real Cursor OAuth smoke test is required
before tagging and Marketplace submission.

### Cursor Marketplace

After Marketplace publication, install **Inkbox** from Cursor's **Customize**
view and choose whether to enable it for your user account or the current
project.

### Local testing

Clone this repository into Cursor's local plugin directory:

```bash
mkdir -p ~/.cursor/plugins/local
git clone https://github.com/inkbox-ai/inkbox.git ~/.cursor/plugins/local/inkbox
```

Restart Cursor or run **Developer: Reload Window** from the command palette.

## Connect to Inkbox

1. Open **Customize** in Cursor and find the Inkbox MCP server.
2. Select **Connect**. Cursor opens the Inkbox authorization page in your
   browser.
3. Sign in to Inkbox.
4. Select an Inkbox organization and identity.
5. Review the requested access and approve the connection.

No API key or OAuth client secret is required. Cursor performs OAuth discovery
and registers as a public OAuth client.

## Usage

Examples:

- "Summarize unread email for my Inkbox identity."
- "Draft a reply to the latest email from Jordan, but do not send it."
- "Send this update by SMS after checking recipient consent."
- "Show me how Alex can connect to this identity over iMessage."
- "Call this contact about the delivery window and wait for the result."
- "Review the transcript from my most recent completed call."
- "Ask @research-agent to investigate this issue over A2A."

Sending messages, placing calls, changing settings, and deleting data affect
external systems or persistent data. Review the tool and arguments Cursor shows
before approving an action.

## Authentication and data access

The Cursor package bundles one MCP server configuration:

```text
https://inkbox.ai/mcp/cursor
```

Authorization is scoped to the organization and identity selected during the
browser consent flow. MCP calls send the arguments needed for the requested
operation to Inkbox and return the corresponding communication data or action
result to Cursor.

The plugin is free to install. An Inkbox account is required, and features and
usage limits depend on the account's existing plan.

Review the [Inkbox Privacy Policy](https://inkbox.ai/privacy-policy),
[Terms of Service](https://inkbox.ai/terms-of-service), and
[MCP documentation](https://inkbox.ai/docs/mcp) for more information.

## Disconnect

Disable or uninstall Inkbox from Cursor's **Customize** view to stop Cursor from
loading the MCP server. To change the authorized organization or identity,
disconnect the server and complete the browser authorization flow again.

## Support and security

- Product support: [support@inkbox.ai](mailto:support@inkbox.ai)
- Contact: [inkbox.ai/contact](https://inkbox.ai/contact)
- Security reports: [security@inkbox.ai](mailto:security@inkbox.ai)

## License

[MIT](LICENSE)

See the [Cursor plugin changelog](CURSOR_PLUGIN_CHANGELOG.md) for package
releases.
