"""
inkbox/_config.py

Resolve client settings from explicit args, then env vars, then the
``~/.inkbox/config`` file. Background / agent processes often don't inherit
the shell's env, so a file fallback is handy.

The config file is a simple ``key = value`` text file: one pair per line,
``#`` comments and blank lines ignored, surrounding quotes stripped. Same
format the CLI reads.
"""

from __future__ import annotations

import os
from pathlib import Path

_CONFIG_PATH = Path.home() / ".inkbox" / "config"

# setting name -> env var
_ENV_VARS = {
    "api_key": "INKBOX_API_KEY",
    "base_url": "INKBOX_BASE_URL",
    "vault_key": "INKBOX_VAULT_KEY",
}


def _read_config_file() -> dict[str, str]:
    try:
        text = _CONFIG_PATH.read_text(encoding="utf-8")
    except OSError:
        return {}
    out: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip("\"'")
    return out


def resolve_client_settings(
    *,
    api_key: str | None,
    base_url: str | None,
    vault_key: str | None,
) -> tuple[str | None, str | None, str | None]:
    """Resolve (api_key, base_url, vault_key): arg → env → config file."""
    file_cfg: dict[str, str] | None = None

    def pick(name: str, explicit: str | None) -> str | None:
        nonlocal file_cfg
        if explicit is not None:
            return explicit
        env_val = os.environ.get(_ENV_VARS[name])
        if env_val:
            return env_val
        if file_cfg is None:
            file_cfg = _read_config_file()
        return file_cfg.get(name)

    return (
        pick("api_key", api_key),
        pick("base_url", base_url),
        pick("vault_key", vault_key),
    )
