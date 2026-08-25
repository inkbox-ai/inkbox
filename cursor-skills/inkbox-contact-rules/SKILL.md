---
name: inkbox-contact-rules
description: Inspect Inkbox mail, phone, and iMessage contact rules and preflight an outbound phone destination. Use when the user asks who may contact an identity, why a call or text is blocked, or whether a destination would pass phone rules.
---

# Inkbox contact rules

This Cursor MCP connection exposes contact-rule reads and phone preflight, not
rule creation, updates, deletion, or filter-mode changes.

## Workflow

1. Use `inkbox_contact_rules_list` to inspect visible mail, phone, and iMessage
   rules and their identity-scoped filter modes. Follow offset pagination when
   necessary.
2. Use `inkbox_phone_contact_rule_preflight` with the exact phone number ID and
   E.164 recipient to predict the same rule decision used for outbound calls and
   SMS.
3. For SMS, also use `inkbox_sms_consent_get`; contact-rule approval does not
   prove recipient consent or complete sender readiness.
4. Explain the matching rule and channel without claiming that the read changed
   policy.

If the user asks to add, edit, delete, or switch rule modes, explain that the
connected Cursor tool set cannot make that change. Do not simulate an edit or
send through another number to bypass a block.
