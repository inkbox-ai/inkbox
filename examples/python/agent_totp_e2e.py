"""
examples/python/agent_totp_e2e.py

End-to-end example: TOTP from an agent identity's perspective.

Uses the public TOTP challenge at https://authenticationtest.com/totpChallenge/
  - Email:  totp@authenticationtest.com
  - Password: pa$$w0rd
  - TOTP secret: I65VU7K5ZQL7WB4E

Requires INKBOX_API_KEY, INKBOX_VAULT_KEY, and optionally INKBOX_AGENT_HANDLE.
"""

import os
import time

from inkbox import Inkbox
from inkbox.vault.totp import parse_totp_uri
from inkbox.vault.types import LoginPayload

api_key = os.environ["INKBOX_API_KEY"]
vault_key = os.environ["INKBOX_VAULT_KEY"]
agent_handle = os.environ.get("INKBOX_AGENT_HANDLE", "totp-demo-agent")

TOTP_URI = "otpauth://totp/totp@authenticationtest.com?secret=I65VU7K5ZQL7WB4E"

sep = lambda: print("=" * 60)

with Inkbox(api_key=api_key, vault_key=vault_key) as inkbox:

    # ── 1. Create (or get) an agent identity ──
    sep()
    print("1. Setting up agent identity...")
    try:
        identity = inkbox.get_identity(agent_handle)
        print(f"   Found existing identity: {identity.agent_handle} (id={identity.id})")
    except Exception:
        identity = inkbox.create_identity(agent_handle)
        print(f"   Created identity: {identity.agent_handle} (id={identity.id})")

    # ── 2. Agent creates a login secret with TOTP (auto-grants access) ──
    sep()
    print("\n2. Creating login secret with TOTP...")
    totp_config = parse_totp_uri(TOTP_URI)
    secret = identity.create_secret(
        name="authenticationtest.com",
        payload=LoginPayload(
            username="totp@authenticationtest.com",
            password="pa$$w0rd",
            url="https://authenticationtest.com/totpChallenge/",
            totp=totp_config,
        ),
        description="TOTP MFA Authentication Challenge",
    )
    secret_id = str(secret.id)
    print(f"   Secret created: id={secret_id}")

    # ── 3. Agent lists credentials ──
    sep()
    print("\n3. Listing credentials...")
    creds = identity.credentials
    print(f"   Total credentials: {len(creds)}")
    for login in creds.list_logins():
        print(f"     - {login.name} (id={login.id})")
        print(f"       username: {login.payload.username}")
        print(f"       has TOTP: {login.payload.totp is not None}")

    # ── 4. Agent generates TOTP code ──
    sep()
    print("\n4. Generating TOTP code...")
    code = identity.get_totp_code(secret_id)
    print(f"   Code: {code.code}")
    print(f"   Valid: {code.period_start} - {code.period_end}")
    print(f"   Remaining: {code.seconds_remaining}s")

    # ── 5. Agent generates codes over time ──
    sep()
    print("\n5. Generating codes over time (5 rounds, 5s apart)...")
    for i in range(5):
        code = identity.get_totp_code(secret_id)
        print(f"   [{i+1}/5] Code: {code.code} | Remaining: {code.seconds_remaining}s")
        if i < 4:
            time.sleep(5)

    # ── 6. Agent overwrites TOTP via URI ──
    sep()
    print("\n6. Overwriting TOTP via URI...")
    identity.set_totp(secret_id, TOTP_URI)
    code = identity.get_totp_code(secret_id)
    print(f"   Code after replace: {code.code}")

    # ── 7. Agent removes TOTP ──
    sep()
    print("\n7. Removing TOTP...")
    identity.remove_totp(secret_id)
    fetched = identity.get_secret(secret_id)
    assert fetched.payload.totp is None
    print("   TOTP removed")

    # ── 8. Agent re-adds TOTP ──
    sep()
    print("\n8. Re-adding TOTP...")
    identity.set_totp(secret_id, totp_config)
    code = identity.get_totp_code(secret_id)
    print(f"   Code after re-add: {code.code}")

    # ── 9. Cleanup ──
    sep()
    print("\n9. Cleanup...")
    identity.delete_secret(secret_id)
    print(f"   Deleted secret {secret_id}")

    # ── Done ──
    sep()
    print("\nALL CHECKS PASSED")
    sep()
