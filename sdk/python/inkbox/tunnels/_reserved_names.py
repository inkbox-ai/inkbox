"""
inkbox/tunnels/_reserved_names.py

Local mirror of the server's reserved-name set for handles /
tunnel-names / platform mailbox local parts. Keep in sync with
``~/servers/src/utils/reserved_names.py`` and the
``_TUNNEL_SPECIFIC_RESERVED`` constant in
``~/servers/src/data_models/api_contracts/tunnel.py``.

Client-side enforcement is a UX nicety; the server is authoritative.
"""

from __future__ import annotations

import re

_INKBOX_BRAND_RESERVED: frozenset[str] = frozenset({
    "idenagent",
    "inkbox",
    "inkboxai",
    "inkboxmail",
    "inkboxteam",
    "getvectorly",
    "vectorly",
    "vectorlyai",
})

_AI_PROVIDER_RESERVED: frozenset[str] = frozenset({
    "anthropic",
    "anysphere",
    "chatgpt",
    "claude",
    "codex",
    "cohere",
    "copilot",
    "cursor",
    "deepmind",
    "deepseek",
    "gemini",
    "grok",
    "grokai",
    "huggingface",
    "llama",
    "mistral",
    "openai",
    "perplexity",
    "windsurf",
    "xai",
})

_MAJOR_TECH_RESERVED: frozenset[str] = frozenset({
    "amazon",
    "apple",
    "aws",
    "facebook",
    "github",
    "google",
    "instagram",
    "linkedin",
    "meta",
    "metaai",
    "microsoft",
    "netflix",
    "paypal",
    "slack",
    "stripe",
    "tiktok",
    "twitter",
    "uber",
    "venmo",
})

_TUNNEL_SPECIFIC_RESERVED: frozenset[str] = frozenset({
    # Inkbox-owned subdomains
    "admin", "api", "app", "console", "mail", "mcp", "tunnel", "www",
    # Common infra subdomains
    "assets", "beta", "blog", "cdn", "css", "dev", "development",
    "dns", "docs", "documentation", "ftp", "imap", "img", "images",
    "internal", "intranet", "js", "local", "localhost", "media",
    "mx", "pop", "pop3", "private", "prod", "production", "proxy",
    "smtp", "ssh", "ssl", "stage", "staging", "static", "test",
    "tls", "vpn", "webhook", "webhooks",
    # Status / monitoring
    "grafana", "health", "healthcheck", "kibana", "metrics",
    "monitor", "monitoring", "prometheus", "status",
    # Auth / identity
    "auth", "idp", "login", "mfa", "oauth", "otp", "saml", "signin",
    "signup", "sso",
    # Support / business
    "accounts", "billing", "careers", "compliance", "contact", "help",
    "info", "jobs", "legal", "press", "privacy", "sales", "security",
    "support",
})

_ALL_RESERVED: frozenset[str] = (
    _INKBOX_BRAND_RESERVED
    | _AI_PROVIDER_RESERVED
    | _MAJOR_TECH_RESERVED
    | _TUNNEL_SPECIFIC_RESERVED
)


def _canonicalize(s: str, separators: str = "-") -> str:
    """Lowercase ``s`` and strip every character in ``separators``.

    Default ``separators="-"`` matches DNS-label-strict consumers
    (DNS labels can carry only ``-``).
    """
    out = s.lower()
    for sep in separators:
        out = out.replace(sep, "")
    return out


def _name_pattern(*names: str) -> re.Pattern[str]:
    """Build a regex matching any of ``names`` as singletons, or any
    pair of ``names`` in either order with optional ``._-`` separator."""
    singles = "|".join(re.escape(n) for n in names)
    pairs: list[str] = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            pairs.append(f"{re.escape(a)}[._-]?{re.escape(b)}")
            pairs.append(f"{re.escape(b)}[._-]?{re.escape(a)}")
    return re.compile(
        pattern=f"^({'|'.join([singles] + pairs)})$",
        flags=re.IGNORECASE,
    )


_TEAM_MEMBER_NAME_PATTERNS: list[re.Pattern[str]] = [
    _name_pattern("ray", "ruizhi", "liao"),
    _name_pattern("dima", "dmytro", "vremenko"),
    _name_pattern("alex", "alexander", "wilcox"),
]


def is_reserved_name(name: str) -> bool:
    """True if ``name`` collides with the reserved set: tunnel-specific
    labels, brand-impersonation labels, the Amplify preview prefixes
    (``pr-*`` / ``console-pr-*``), or any Inkbox team-member name
    pattern. Mirrors ``_is_reserved_tunnel_name`` on the server side."""
    if name.startswith("console-pr-") or name.startswith("pr-"):
        return True
    if _canonicalize(name, "-") in _ALL_RESERVED:
        return True
    for pattern in _TEAM_MEMBER_NAME_PATTERNS:
        if pattern.match(name):
            return True
    return False
