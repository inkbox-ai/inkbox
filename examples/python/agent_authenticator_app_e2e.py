"""
examples/python/agent_authenticator_app_e2e.py

End-to-end example: authenticator app lifecycle via the Inkbox SDK.

Requires INKBOX_API_KEY in the environment.
"""

import os
import time

from inkbox import Inkbox

api_key = os.environ["INKBOX_API_KEY"]
inkbox = Inkbox(api_key=api_key)

# ── 1. List identities, find one without an authenticator app ──
print("=" * 60)
print("1. Listing agent identities...")
identities = inkbox.list_identities()
print(f"   Found {len(identities)} identities")

agent_identity = None
for summary in identities:
    identity = inkbox.get_identity(summary.agent_handle)
    if identity.authenticator_app is None:
        agent_identity = identity
        break

if agent_identity is None:
    print("   ERROR: No identity without an authenticator app found! Start by creating an agent identity.")
    raise SystemExit(1)

print(f"   Using identity: {agent_identity.agent_handle} (id={agent_identity.id})")
print(f"   Authenticator app: {agent_identity.authenticator_app}")
assert agent_identity.authenticator_app is None

# ── 2. Create authenticator app ──
print("\n" + "=" * 60)
print("2. Creating authenticator app...")
app = agent_identity.create_authenticator_app()
print(f"   App created: id={app.id}, status={app.status}")
assert agent_identity.authenticator_app is not None
print(f"   Identity now has app: id={agent_identity.authenticator_app.id}")

# ── 3. List authenticator apps to verify it's attached ──
print("\n" + "=" * 60)
print("3. Listing authenticator apps (org-level)...")
apps = inkbox.authenticator_apps.list()
app_ids = [str(a.id) for a in apps]
print(f"   Found {len(apps)} apps: {app_ids}")
assert str(app.id) in app_ids, f"Created app {app.id} not found in list!"
print(f"   Confirmed: app {app.id} exists in org app list")

# ── 4. List accounts — should be empty ──
print("\n" + "=" * 60)
print("4. Listing authenticator accounts (should be 0)...")
accounts = agent_identity.list_authenticator_accounts()
print(f"   Found {len(accounts)} accounts")
assert len(accounts) == 0, f"Expected 0 accounts, got {len(accounts)}"

# ── 5. Create account from otpauth URI ──
print("\n" + "=" * 60)
print("5. Creating authenticator account...")
otpauth_uri = "otpauth://totp/totp@authenticationtest.com?secret=I65VU7K5ZQL7WB4E"
account = agent_identity.create_authenticator_account(
    otpauth_uri=otpauth_uri,
    display_name="TOTP MFA Authentication Challenge",
    description="The challenge is to use a TOTP API to complete the automated authentication to this page.",
)
print(f"   Account created: id={account.id}")
print(f"   OTP type: {account.otp_type}")
print(f"   Issuer: {account.issuer}")
print(f"   Algorithm: {account.algorithm}")
print(f"   Digits: {account.digits}")
print(f"   Period: {account.period}s")

# ── 6. List accounts — should be 1 ──
print("\n" + "=" * 60)
print("6. Listing accounts (should be 1)...")
accounts = agent_identity.list_authenticator_accounts()
print(f"   Found {len(accounts)} account(s)")
assert len(accounts) == 1, f"Expected 1 account, got {len(accounts)}"
assert str(accounts[0].id) == str(account.id)
print(f"   Confirmed: account {account.id} exists")

# ── 7. Generate OTP codes (5x with 10s sleep) ──
print("\n" + "=" * 60)
print("7. Generating OTP codes (5 rounds, 10s apart)...")
for i in range(5):
    otp = agent_identity.generate_otp(str(account.id))
    print(f"   [{i+1}/5] Code: {otp.otp_code} | "
          f"Valid for: {otp.valid_for_seconds}s | "
          f"Type: {otp.otp_type} | "
          f"Algorithm: {otp.algorithm} | "
          f"Digits: {otp.digits}")
    if i < 4:
        print(f"         Sleeping 10s...")
        time.sleep(10)

# ── 8. Delete the account ──
print("\n" + "=" * 60)
print("8. Deleting authenticator account...")
agent_identity.delete_authenticator_account(str(account.id))
print(f"   Deleted account {account.id}")

# ── 9. List accounts — should be 0 again ──
print("\n" + "=" * 60)
print("9. Listing accounts (should be 0 again)...")
accounts = agent_identity.list_authenticator_accounts()
print(f"   Found {len(accounts)} accounts")
assert len(accounts) == 0, f"Expected 0 accounts, got {len(accounts)}"
print("   Confirmed: no accounts remain")

# ── 10. Unlink authenticator app from identity ──
print("\n" + "=" * 60)
print("10. Unlinking authenticator app from identity...")
agent_identity.unlink_authenticator_app()
print(f"    Local authenticator_app: {agent_identity.authenticator_app}")
assert agent_identity.authenticator_app is None

# ── 11. Refresh identity and confirm app is gone ──
print("\n" + "=" * 60)
print("11. Refreshing identity to confirm app is detached...")
agent_identity.refresh()
print(f"    Authenticator app: {agent_identity.authenticator_app}")
assert agent_identity.authenticator_app is None
print("    Confirmed: identity no longer has an authenticator app")

# ── Done ──
print("\n" + "=" * 60)
print("ALL CHECKS PASSED")
print("=" * 60)
