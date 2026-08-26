---
name: inkbox-mcp
description: Configure or troubleshoot a hosted Inkbox MCP connection. Use for plugin installation, browser OAuth, reconnecting, identity selection, connection failures, host-profile differences, or tool discovery; do not use when Inkbox tools already work and the user wants a communication task.
---

# Inkbox MCP

Official Inkbox plugins connect through a hosted, host-specific MCP endpoint:

- Cursor: `https://inkbox.ai/mcp/cursor`
- Claude Code: `https://inkbox.ai/mcp/anthropic`
- Codex and generic clients: `https://inkbox.ai/mcp`

The installed plugin supplies the correct URL. Do not replace it with another
host's endpoint, ask the user for an API key, or add custom authorization
headers.

## Connect

1. Enable the Inkbox MCP server from the host's plugin or MCP settings.
2. Select **Connect** when the host requests authorization.
3. Complete sign-in in the browser, select an Inkbox organization and identity,
   review the requested access, and approve it.
4. Return to the agent host. Use `inkbox_identity_get` to verify the selected
   identity, then `inkbox_channel_status_get` to inspect channel readiness.

The browser flow is the authorization boundary. Never claim to have selected a
different organization or identity unless the connection was authorized again.

## Troubleshoot

- If the host shows the server as disconnected, reconnect it from MCP settings and
  complete the browser flow again.
- If authorization was canceled or expired, start a new connection instead of
  asking for credentials in chat.
- If tools are present but a channel action fails, inspect
  `inkbox_channel_status_get`; connection success does not guarantee that every
  channel is provisioned and ready.
- If the wrong identity is active, disconnect and reconnect so the user can make
  a new selection in the authorization page.
- If no Inkbox tools are visible after installation, reload the host and confirm
  that the plugin and its MCP server are enabled.
- Tool availability can differ by host profile. Treat the connected server's
  advertised catalog as authoritative instead of assuming every Inkbox tool is
  present.

Do not invent a local MCP process, environment variable, or client secret.
Official plugins use the hosted server and the agent host's OAuth support.
