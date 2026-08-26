---
name: inkbox-contact-rules
description: Inspect Inkbox mail, phone, and iMessage contact rules and preflight an outbound phone destination. Use when the user asks who may contact an identity, why a call or text is blocked, or whether a destination would pass phone rules.
---

# Inkbox contact rules

Inkbox MCP exposes contact-rule reads, but host profiles can differ on whether
phone preflight is available. No MCP profile exposes rule creation, updates,
deletion, or filter-mode changes.

## Workflow

1. Use `inkbox_contact_rules_list` to inspect visible mail, phone, and iMessage
   rules and their identity-scoped filter modes. Follow offset pagination when
   necessary.
2. When `inkbox_phone_contact_rule_preflight` is available, use it with the exact
   phone number ID and E.164 recipient to predict the same rule decision used
   for outbound calls and SMS. If it is absent, do not claim a standalone
   preflight was performed.
3. For SMS, also use `inkbox_sms_consent_get`; contact-rule approval does not
   prove recipient consent or complete sender readiness.
4. Explain the matching rule and channel without claiming that the read changed
   policy.

If the user asks to add, edit, delete, or switch rule modes, explain that the
connected MCP tool set cannot make that change. Do not simulate an edit or send
through another number to bypass a block.
