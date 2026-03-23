"""
examples/python/vault_totp_e2e.py

End-to-end example: TOTP via the Inkbox vault.

Uses the public TOTP challenge at https://authenticationtest.com/totpChallenge/
  - Email:  totp@authenticationtest.com
  - Password: pa$$w0rd
  - TOTP secret: I65VU7K5ZQL7WB4E

Requires INKBOX_API_KEY and INKBOX_VAULT_KEY in the environment.
"""

import os
import time

from inkbox import Inkbox
from inkbox.vault.totp import TOTPConfig, parse_totp_uri

api_key = os.environ["INKBOX_API_KEY"]
vault_key = os.environ["INKBOX_VAULT_KEY"]

TOTP_URI = "otpauth://totp/totp@authenticationtest.com?secret=I65VU7K5ZQL7WB4E"
SECRET_NAME = "TOTP MFA Authentication Challenge"
SECRET_DESCRIPTION = (
    "Many modern and secure web applications use multiple factors of "
    "authentication to ensure you are who you say you are. This makes it "
    "harder to automate authentication during scanning. The challenge is to "
    "use a TOTP API to complete the automated authentication to this page."
)

sep = lambda: print("=" * 60)



with Inkbox(api_key=api_key, vault_key=vault_key) as inkbox:
    unlocked = inkbox.vault._unlocked
    assert unlocked is not None, "Vault must be unlocked"

    # ── 1. Create a login secret with TOTP ──
    sep()
    print("1. Creating login secret with TOTP config...")
    totp_config = parse_totp_uri(TOTP_URI)
    print(f"   Parsed TOTP URI:")
    print(f"     Secret:    {totp_config.secret}")
    print(f"     Algorithm: {totp_config.algorithm}")
    print(f"     Digits:    {totp_config.digits}")
    print(f"     Period:    {totp_config.period}s")

    from inkbox.vault.types import LoginPayload
    secret = unlocked.create_secret(
        name=SECRET_NAME,
        payload=LoginPayload(
            username="totp@authenticationtest.com",
            password="pa$$w0rd",
            url="https://authenticationtest.com/totpChallenge/",
            totp=totp_config,
        ),
        description=SECRET_DESCRIPTION,
    )
    secret_id = str(secret.id)
    print(f"   Secret created: id={secret_id}")

    # ── 2. Fetch the secret back and verify TOTP is stored ──
    sep()
    print("\n2. Fetching secret back...")
    fetched = unlocked.get_secret(secret_id)
    assert fetched.payload.totp is not None, "TOTP config should be present"
    print(f"   Name:     {fetched.name}")
    print(f"   Username: {fetched.payload.username}")
    print(f"   URL:      {fetched.payload.url}")
    print(f"   TOTP:     secret={fetched.payload.totp.secret}, "
          f"algorithm={fetched.payload.totp.algorithm}, "
          f"digits={fetched.payload.totp.digits}, "
          f"period={fetched.payload.totp.period}s")

    # ── 3. Generate TOTP codes (5 rounds, 5s apart) ──
    sep()
    print("\n3. Generating TOTP codes (5 rounds, 5s apart)...")
    for i in range(5):
        code = unlocked.get_totp_code(secret_id)
        print(f"   [{i+1}/5] Code: {code.code} | "
              f"Valid: {code.period_start}-{code.period_end} | "
              f"Remaining: {code.seconds_remaining}s")
        if i < 4:
            time.sleep(5)

    # ── 4. Also generate via the TOTPConfig directly ──
    sep()
    print("\n4. Generating code directly from TOTPConfig...")
    direct_code = fetched.payload.totp.generate_code()
    print(f"   Code: {direct_code.code} | Remaining: {direct_code.seconds_remaining}s")

    # ── 5. Set TOTP via URI (overwrite) ──
    sep()
    print("\n5. Overwriting TOTP via URI string...")
    unlocked.set_totp(secret_id, TOTP_URI)
    print("   TOTP replaced via URI")
    code_after = unlocked.get_totp_code(secret_id)
    print(f"   Code after replace: {code_after.code}")

    # ── 6. Remove TOTP ──
    sep()
    print("\n6. Removing TOTP from secret...")
    unlocked.remove_totp(secret_id)
    fetched_no_totp = unlocked.get_secret(secret_id)
    assert fetched_no_totp.payload.totp is None, "TOTP should be removed"
    print("   TOTP removed successfully")

    # ── 7. Re-add TOTP and verify ──
    sep()
    print("\n7. Re-adding TOTP...")
    unlocked.set_totp(secret_id, totp_config)
    code_readded = unlocked.get_totp_code(secret_id)
    print(f"   Code after re-add: {code_readded.code}")

    # ── 8. Cleanup: delete the secret ──
    sep()
    print("\n8. Deleting secret (cleanup)...")
    unlocked.delete_secret(secret_id)
    print(f"   Deleted secret {secret_id}")

    # ── Done ──
    sep()
    print("\nALL CHECKS PASSED")
    sep()
