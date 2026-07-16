"""
inkbox/tunnels/client/_state.py

Hardened on-disk persistence for the tunnel state file (tunnel_id, zone,
public_host, mode) and for the passthrough keypair / cert chain.

The directory layout is:

    {state_dir}/
      state.json         # mode 0o600
      private_key.pem    # passthrough only, mode 0o600
      cert_chain.pem     # passthrough only, mode 0o600

Atomic writes via ``tempfile.NamedTemporaryFile`` + ``os.replace``. Initial
file creation uses ``O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW`` so a planted
symlink can't trick the SDK into clobbering an unrelated path. The
``state_dir`` itself is required to NOT be a symlink (we ``lstat`` and
refuse).
"""

from __future__ import annotations

import json
import os
import stat as _stat
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

STATE_FILE = "state.json"
KEY_FILE = "private_key.pem"
CERT_FILE = "cert_chain.pem"


class TunnelStateError(RuntimeError):
    """Raised when the state directory is unsafe to use (e.g. symlinked)."""


@dataclass(frozen=True)
class StateEntry:
    """Parsed contents of ``state.json`` (forward-compatible).

    Pre-0.4.0 SDKs persisted the per-tunnel ``connect_secret`` here; the
    field is ignored on read and never written. Data-plane authentication
    now uses the client's API key.
    """
    tunnel_id: str
    name: str
    mode: str | None
    zone: str | None
    public_host: str | None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> StateEntry:
        return cls(
            tunnel_id=str(data.get("tunnel_id", "")),
            name=str(data.get("name", "")),
            mode=data.get("mode"),
            zone=data.get("zone"),
            public_host=data.get("public_host"),
        )

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "tunnel_id": self.tunnel_id,
            "name": self.name,
        }
        if self.mode is not None:
            out["mode"] = self.mode
        if self.zone is not None:
            out["zone"] = self.zone
        if self.public_host is not None:
            out["public_host"] = self.public_host
        return out


def ensure_private_state_dir(state_dir: Path) -> None:
    """Create ``state_dir`` (mode 0o700) and refuse symlinked targets."""
    if state_dir.exists() or state_dir.is_symlink():
        st = os.lstat(state_dir)
        if _stat.S_ISLNK(st.st_mode):
            raise TunnelStateError(
                f"refusing to use a symlinked state_dir ({state_dir}); "
                "resolve and pass the real path",
            )
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        os.chmod(state_dir, 0o700)
    except OSError:
        pass


def load_state(state_dir: Path) -> StateEntry | None:
    """Read + parse ``state.json``; return ``None`` on missing/corrupt file."""
    state_path = state_dir / STATE_FILE
    if not state_path.is_file():
        return None
    try:
        return StateEntry.from_dict(json.loads(state_path.read_text()))
    except (OSError, json.JSONDecodeError):
        return None


def save_state(state_dir: Path, entry: StateEntry) -> None:
    """Atomically write ``state.json`` (mode 0o600)."""
    ensure_private_state_dir(state_dir)
    target = state_dir / STATE_FILE
    payload = json.dumps(entry.to_dict(), indent=2, sort_keys=True)
    _atomic_write(target, payload.encode("utf-8"))


def write_private_file(target: Path, content: bytes) -> None:
    """Atomically write a private file (mode 0o600).

    First-create uses ``O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW`` to refuse
    following a planted symlink; subsequent updates go through the
    standard tempfile-then-rename atomic path.
    """
    if target.exists() or target.is_symlink():
        _atomic_write(target, content)
        return
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(target, flags, 0o600)
    try:
        os.write(fd, content)
    finally:
        os.close(fd)


def _atomic_write(target: Path, content: bytes) -> None:
    state_dir = target.parent
    fd, tmp_path = tempfile.mkstemp(prefix=".tmp-", dir=state_dir)
    try:
        try:
            os.fchmod(fd, 0o600)
        except (AttributeError, OSError):
            pass
        with os.fdopen(fd, "wb") as f:
            f.write(content)
        os.replace(tmp_path, target)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass
