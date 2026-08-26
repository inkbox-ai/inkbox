---
name: inkbox-outbound-calling
description: Place or end hosted outbound Inkbox calls through a connected MCP server that exposes call-control tools. Use when the user asks to call a phone number or contact, inspect call readiness, choose a supported origination path, or hang up an active call.
---

# Inkbox outbound calling

This workflow requires `inkbox_call_place`, `inkbox_call_hangup`,
`inkbox_call_settings_get`, and `inkbox_phone_contact_rule_preflight`. Some host
profiles intentionally omit hosted-call controls. If those tools are absent,
explain that the current MCP connection cannot place or end calls; do not invent
a substitute tool or claim the call was queued.

`inkbox_call_place` queues a hosted call and returns immediately. It does not
make the current agent conversation a live voice session, and the conversation
will not automatically resume when the call ends.

## Before placing a call

1. Resolve a named recipient with `inkbox_contacts_list` and
   `inkbox_contact_get`. Ask when multiple contacts or phone numbers match.
2. Use `inkbox_channel_status_get` and `inkbox_call_settings_get` to verify
   calling readiness.
3. Use `inkbox_phone_contact_rule_preflight` for the chosen destination when a
   dedicated sending number is available. A blocked result must not be bypassed.
4. Confirm the exact destination and reason if either was inferred. Phone calls
   are externally visible and may incur usage.

## Choose the origination

- `dedicated_number` uses the identity's phone line and requires `from_number`
  set to that exact E.164 number from the identity read.
- `shared_imessage_number` continues an eligible shared iMessage connection. It
  does not use `from_number`; omit it.
- `dedicated_imessage_number` uses a call-ready dedicated iMessage line and
  surfaces that line as caller ID.

Choose from current channel and call readiness plus the user's communication
context. Do not silently substitute another line when the requested route is not
ready.

## Place and monitor

Call `inkbox_call_place` with the E.164 destination, selected `origination`, any
required `from_number`, and a complete, truthful `reason`. The reason is the
hosted voice agent's task brief: include what it should do or say and the context
it needs, not merely an audit label. Do not invent a media WebSocket URL.

If placement is ambiguous, inspect recent calls before deciding whether another
call is safe; never place a second call merely because the first result was
unclear.

Use the returned call ID with `inkbox_call_get` to inspect state. Poll only when
the user asks you to wait for an outcome, and use a reasonable interval. Use
`inkbox_call_hangup` only for a visible active call. Queuing hangup does not prove
the call has already ended; verify the resulting state.
