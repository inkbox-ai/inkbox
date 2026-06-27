"""
Agent self-signup example — register, verify, check status, send welcome email.

Requires no pre-existing API key for registration. After the human approves
with the 6-digit code, verify and optionally send a welcome email.

Environment variables (see .env.example):
  INKBOX_HUMAN_EMAIL       — human who receives the verification email (register)
  INKBOX_NOTE_TO_HUMAN     — message included in the verification email (register)
  INKBOX_AGENT_HANDLE      — optional base handle; a unique suffix is appended
  INKBOX_API_KEY           — one-time key returned by register (all other steps)
  INKBOX_AGENT_HANDLE_SAVED — handle returned by register (send-welcome, cleanup)
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid

from inkbox import Inkbox


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"ERROR: {name} is required.", file=sys.stderr)
        sys.exit(1)
    return value


def _require_api_key() -> str:
    return _require_env("INKBOX_API_KEY")


def _print_status(status) -> None:
    print(f"  claim_status:        {status.claim_status}")
    print(f"  human_state:         {status.human_state}")
    print(f"  human_email:         {status.human_email}")
    print(f"  max_sends_per_day:   {status.restrictions.max_sends_per_day}")
    print(f"  allowed_recipients:  {', '.join(status.restrictions.allowed_recipients) or '-'}")
    print(f"  can_receive:         {status.restrictions.can_receive}")
    print(f"  can_create_mailboxes: {status.restrictions.can_create_mailboxes}")


def cmd_register(args: argparse.Namespace) -> None:
    human_email = _require_env("INKBOX_HUMAN_EMAIL")
    note = os.environ.get(
        "INKBOX_NOTE_TO_HUMAN",
        "Hey! This is my agent signing up via the Inkbox signup example.",
    ).strip()
    base_handle = os.environ.get("INKBOX_AGENT_HANDLE", "signup-demo").strip()
    suffix = uuid.uuid4().hex[:8]
    agent_handle = f"{base_handle}-{suffix}"

    result = Inkbox.signup(
        human_email=human_email,
        note_to_human=note,
        display_name="Signup Demo Agent",
        agent_handle=agent_handle,
        email_local_part=agent_handle,
        harness="cursor",
    )

    print()
    print("Agent registered successfully!")
    print()
    print(f"  Email:    {result.email_address}")
    print(f"  Handle:   {result.agent_handle}")
    print(f"  Org:      {result.organization_id}")
    print(f"  Status:   {result.claim_status}")
    print()
    print(f"  API Key:  {result.api_key}")
    print()
    print("Save the API key — it is shown only once.")
    print(f"A verification email has been sent to {result.human_email}.")
    print()
    print("Next steps:")
    print("  1. Add INKBOX_API_KEY to your .env")
    print(f"  2. Add INKBOX_AGENT_HANDLE_SAVED={result.agent_handle} to your .env")
    print("  3. Run: agent_signup.py status")
    print("  4. After the human shares the code: agent_signup.py verify --code <code>")


def cmd_status(_args: argparse.Namespace) -> None:
    api_key = _require_api_key()
    status = Inkbox.get_signup_status(api_key)
    print("Signup status:")
    _print_status(status)


def cmd_verify(args: argparse.Namespace) -> None:
    api_key = _require_api_key()
    code = args.code or os.environ.get("INKBOX_VERIFICATION_CODE", "").strip()
    if not code:
        print("ERROR: Pass --code or set INKBOX_VERIFICATION_CODE.", file=sys.stderr)
        sys.exit(1)

    result = Inkbox.verify_signup(api_key, verification_code=code)
    print()
    print("Verification successful!")
    print(f"  claim_status: {result.claim_status}")
    print(f"  org:          {result.organization_id}")
    print(f"  message:      {result.message}")
    print()
    print("Next: agent_signup.py send-welcome")


def cmd_resend(_args: argparse.Namespace) -> None:
    api_key = _require_api_key()
    result = Inkbox.resend_signup_verification(api_key)
    print()
    print("Verification email resent.")
    print(f"  claim_status: {result.claim_status}")
    print(f"  org:          {result.organization_id}")
    print(f"  message:      {result.message}")


def cmd_send_welcome(_args: argparse.Namespace) -> None:
    api_key = _require_api_key()
    handle = _require_env("INKBOX_AGENT_HANDLE_SAVED")

    with Inkbox(api_key=api_key) as inkbox:
        identity = inkbox.get_identity(handle)
        status = Inkbox.get_signup_status(api_key)
        identity.send_email(
            to=[status.human_email],
            subject="Hello from your agent!",
            body_text=(
                f"Hi! I'm {identity.agent_handle} ({identity.email_address}). "
                "I'm all set up after verification."
            ),
        )
        print(f"Sent welcome email to {status.human_email}")
        print(f"  from: {identity.email_address}")


def cmd_cleanup(_args: argparse.Namespace) -> None:
    api_key = _require_api_key()
    handle = _require_env("INKBOX_AGENT_HANDLE_SAVED")

    with Inkbox(api_key=api_key) as inkbox:
        identity = inkbox.get_identity(handle)
        identity.delete()
        print(f"Deleted identity: {handle}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inkbox agent self-signup example",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("register", help="Register a new agent (no API key required)")
    sub.add_parser("status", help="Check signup claim status and restrictions")
    verify_p = sub.add_parser("verify", help="Submit the 6-digit verification code")
    verify_p.add_argument("--code", help="6-digit code from the verification email")
    sub.add_parser("resend", help="Resend the verification email (5-minute cooldown)")
    sub.add_parser("send-welcome", help="Send a welcome email to the human (after verify)")
    sub.add_parser("cleanup", help="Delete the demo identity")

    args = parser.parse_args()
    commands = {
        "register": cmd_register,
        "status": cmd_status,
        "verify": cmd_verify,
        "resend": cmd_resend,
        "send-welcome": cmd_send_welcome,
        "cleanup": cmd_cleanup,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()
