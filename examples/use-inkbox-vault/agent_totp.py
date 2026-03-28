"""
Agent TOTP example — create a login with TOTP, generate codes, clean up.

Uses the public TOTP challenge at https://authenticationtest.com/totpChallenge/
  Email:    totp@authenticationtest.com
  Password: pa$$w0rd
  Secret:   I65VU7K5ZQL7WB4E

Requires INKBOX_API_KEY and INKBOX_VAULT_KEY in the environment.
"""

import os
import time

from inkbox import Inkbox
from inkbox.vault.totp import parse_totp_uri
from inkbox.vault.types import LoginPayload

TOTP_URI = "otpauth://totp/totp@authenticationtest.com?secret=I65VU7K5ZQL7WB4E"

with Inkbox(api_key=os.environ["INKBOX_API_KEY"]) as inkbox:

    # Check vault is initialized before attempting unlock
    try:
        inkbox.vault.info()
    except Exception:
        print("ERROR: Vault is not initialized for this organization.")
        print("       Initialize it from the Inkbox console first (inkbox.ai/console).")
        raise SystemExit(1)

    inkbox.vault.unlock(os.environ["INKBOX_VAULT_KEY"])

    # Get or create an agent identity
    handle = os.environ.get("INKBOX_AGENT_HANDLE", "vault-demo-agent")
    try:
        identity = inkbox.get_identity(handle)
    except Exception:
        identity = inkbox.create_identity(handle)
    print(f"Identity: {identity.agent_handle}")

    # Create a login secret with TOTP (auto-grants access to this identity)
    secret = identity.create_secret(
        name="authenticationtest.com",
        payload=LoginPayload(
            username="totp@authenticationtest.com",
            password="pa$$w0rd",
            url="https://authenticationtest.com/totpChallenge/",
            totp=parse_totp_uri(TOTP_URI),
        ),
    )
    secret_id = str(secret.id)
    print(f"Created secret: {secret_id}")

    # List credentials visible to this identity
    for login in identity.credentials.list_logins():
        print(f"  {login.name} — {login.payload.username} (TOTP: {login.payload.totp is not None})")

    # Generate TOTP codes
    for i in range(3):
        code = identity.get_totp_code(secret_id)
        print(f"  Code: {code.code}  expires in {code.seconds_remaining}s")
        if i < 2:
            time.sleep(5)

    # Clean up
    identity.delete_secret(secret_id)
    print("Deleted secret")
