# Changelog

## 0.4.3

### Breaking

- **`identity.unlink_phone_number()` / `IdentitiesResource.unlink_phone_number()` were renamed to `release_phone_number()`** and their behavior changed accordingly. The method now releases the number at the carrier and removes it locally; previously it only cleared the FK on the row and left the carrier-side number live. There is no "unlink without release" path anymore — once a number is released, it cannot be reattached.
- **`identity.assign_phone_number()` (and the underlying `IdentitiesResource.assign_phone_number()`) were removed.** The server no longer supports cross-identity reassignment; phone numbers are bound to the identity they were provisioned on. To attach a number to an identity, either pass the nested `phone_number` payload to `inkbox.create_identity(...)`, or call `inkbox.phone_numbers.provision(agent_handle=..., ...)` for an existing identity.
- **`identity.delete()` cascade now releases the linked phone number** (vendor + local), instead of clearing the FK and leaving the carrier-side number live.
