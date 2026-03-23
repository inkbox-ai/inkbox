"""
scripts/init_vault.py

Initialize a fresh vault for an organization.

Creates the vault with a primary key and 4 recovery codes,
then verifies the vault can be unlocked.

NOTE: The /initialize endpoint requires JWT auth (Clerk), not API key auth.
      This script is for local/dev use with direct DB access or a JWT token.

Requires environment variables:
    INKBOX_API_KEY     - API key (used for unlock verification)
    INKBOX_VAULT_KEY   - The vault key to initialize with
    INKBOX_ORG_ID      - Organization ID (e.g. org_xxxx from Clerk)
    INKBOX_JWT         - (optional) Clerk JWT for /initialize call

Usage:
    cd sdk/python
    uv run --env-file ../../.env python ../../scripts/init_vault.py
"""

import os
import sys
import json
import httpx
from uuid import uuid4

from inkbox.vault.crypto import (
    derive_salt,
    derive_master_key,
    compute_auth_hash,
    generate_org_encryption_key,
    wrap_org_key,
    unwrap_org_key,
    generate_recovery_code,
)
from inkbox.vault._http import HttpTransport

api_key = os.environ.get("INKBOX_API_KEY")
vault_key = os.environ.get("INKBOX_VAULT_KEY")
org_id = os.environ.get("INKBOX_ORG_ID")
jwt = os.environ.get("INKBOX_JWT")

if not api_key:
    print("ERROR: INKBOX_API_KEY not set")
    sys.exit(1)
if not vault_key:
    print("ERROR: INKBOX_VAULT_KEY not set")
    sys.exit(1)
if not org_id:
    print("ERROR: INKBOX_ORG_ID not set")
    print("  Find your org ID in the Clerk dashboard or console.")
    sys.exit(1)
if not jwt:
    print("ERROR: INKBOX_JWT not set")
    print("  Get a JWT from the console: open DevTools > Application > Cookies > __session")
    print("  Or from Clerk's getToken() in the browser console.")
    sys.exit(1)

base_url = os.environ.get("INKBOX_BASE_URL", "https://api.inkbox.ai")

print(f"Org ID:   {org_id}")
print(f"Base URL: {base_url}")

# ── 1. Derive master key ──
print("\nDeriving master key from vault key...")
salt = derive_salt(org_id)
master_key = derive_master_key(vault_key, salt)
auth_hash = compute_auth_hash(master_key)
print(f"  Auth hash: {auth_hash[:16]}...")

# ── 2. Generate org encryption key ──
print("Generating org encryption key...")
org_key = generate_org_encryption_key()

# ── 3. Wrap org key with master key (primary) ──
print("Wrapping org key (primary)...")
primary_key_id = str(uuid4())
wrapped_primary = wrap_org_key(master_key, org_key)

# ── 4. Generate 4 recovery codes ──
print("Generating 4 recovery codes...\n")
recovery_keys = []
recovery_codes_display = []

for i in range(4):
    code, material = generate_recovery_code(
        organization_id=org_id,
        org_encryption_key=org_key,
    )
    recovery_keys.append({
        "id": str(material.id),
        "wrapped_org_encryption_key": material.wrapped_org_encryption_key,
        "auth_hash": material.auth_hash,
        "key_type": "recovery",
    })
    recovery_codes_display.append(code)
    print(f"  Recovery code {i+1}: {code}")

print("\n  *** SAVE THESE RECOVERY CODES — THEY CANNOT BE RETRIEVED LATER ***\n")

# ── 5. POST to /initialize (JWT auth) ──
print("Initializing vault via POST /vault/initialize ...")
body = {
    "vault_key": {
        "id": primary_key_id,
        "wrapped_org_encryption_key": wrapped_primary,
        "auth_hash": auth_hash,
        "key_type": "primary",
    },
    "recovery_keys": recovery_keys,
}

resp = httpx.post(
    f"{base_url}/api/v1/vault/initialize",
    json=body,
    headers={
        "Authorization": f"Bearer {jwt}",
        "Content-Type": "application/json",
    },
    timeout=30,
)

if resp.status_code == 201:
    result = resp.json()
    print(f"  Vault created: {json.dumps(result, indent=2, default=str)}")
elif resp.status_code == 409:
    print("  Vault already initialized for this organization.")
    sys.exit(1)
else:
    print(f"  ERROR: HTTP {resp.status_code}")
    print(f"  {resp.text}")
    sys.exit(1)

# ── 6. Verify unlock (API key auth) ──
print("\nVerifying unlock with API key...")
http = HttpTransport(api_key=api_key, base_url=f"{base_url}/api/v1/vault", timeout=30)
unlock_data = http.get("/unlock", params={"auth_hash": auth_hash})

if unlock_data.get("wrapped_org_encryption_key"):
    unwrapped = unwrap_org_key(master_key, unlock_data["wrapped_org_encryption_key"])
    assert unwrapped == org_key, "Org key mismatch after unlock!"
    print("  Unlock + unwrap verified!")
else:
    print("  WARNING: No wrapped key returned from unlock")

# ── Done ──
print("\nVault initialized successfully.")
print(f"  Primary key ID: {primary_key_id}")
print(f"  Recovery codes: {len(recovery_codes_display)}")
