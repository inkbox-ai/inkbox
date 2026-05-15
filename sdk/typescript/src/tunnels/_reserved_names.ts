/**
 * inkbox-tunnels/_reserved_names.ts
 *
 * Local mirror of the canonical reserved-name set used by the server's
 * handle / tunnel-name / platform-mailbox-local-part validator (see
 * `~/servers/src/utils/reserved_names.py` +
 * `~/servers/src/data_models/api_contracts/tunnel.py`
 * `_TUNNEL_SPECIFIC_RESERVED`).
 *
 * Drift policy: keep this list snapshot-equivalent to the server source
 * of truth. The handle namespace is global so client-side enforcement is
 * a UX nicety; the server is authoritative.
 */

const INKBOX_BRAND_RESERVED: ReadonlySet<string> = new Set([
  "idenagent",
  "inkbox",
  "inkboxai",
  "inkboxmail",
  "inkboxteam",
  "getvectorly",
  "vectorly",
  "vectorlyai",
]);

const AI_PROVIDER_RESERVED: ReadonlySet<string> = new Set([
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
]);

const MAJOR_TECH_RESERVED: ReadonlySet<string> = new Set([
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
]);

const TUNNEL_SPECIFIC_RESERVED: ReadonlySet<string> = new Set([
  // Inkbox-owned subdomains
  "admin", "api", "app", "console", "mail", "mcp", "tunnel", "www",
  // Common infra subdomains
  "assets", "beta", "blog", "cdn", "css", "dev", "development",
  "dns", "docs", "documentation", "ftp", "imap", "img", "images",
  "internal", "intranet", "js", "local", "localhost", "media",
  "mx", "pop", "pop3", "private", "prod", "production", "proxy",
  "smtp", "ssh", "ssl", "stage", "staging", "static", "test",
  "tls", "vpn", "webhook", "webhooks",
  // Status / monitoring
  "grafana", "health", "healthcheck", "kibana", "metrics",
  "monitor", "monitoring", "prometheus", "status",
  // Auth / identity
  "auth", "idp", "login", "mfa", "oauth", "otp", "saml", "signin",
  "signup", "sso",
  // Support / business
  "accounts", "billing", "careers", "compliance", "contact", "help",
  "info", "jobs", "legal", "press", "privacy", "sales", "security",
  "support",
]);

const ALL_RESERVED: ReadonlySet<string> = new Set([
  ...INKBOX_BRAND_RESERVED,
  ...AI_PROVIDER_RESERVED,
  ...MAJOR_TECH_RESERVED,
  ...TUNNEL_SPECIFIC_RESERVED,
]);

/**
 * Lowercase `s` and strip every character in `separators`. Mirrors
 * `canonicalize()` in the server source. The default `separators="-"`
 * is the DNS-label-strict form (DNS labels carry only `-`).
 */
function canonicalize(s: string, separators = "-"): string {
  let out = s.toLowerCase();
  for (const sep of separators) {
    out = out.split(sep).join("");
  }
  return out;
}

/**
 * Build a regex matching any of `names` as singletons, or any pair of
 * `names` in either order with optional `._-` separator.
 */
function namePattern(names: readonly string[]): RegExp {
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const singles = names.map(escape).join("|");
  const pairs: string[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = escape(names[i]);
      const b = escape(names[j]);
      pairs.push(`${a}[._-]?${b}`);
      pairs.push(`${b}[._-]?${a}`);
    }
  }
  return new RegExp(`^(?:${[singles, ...pairs].join("|")})$`, "i");
}

const TEAM_MEMBER_NAME_PATTERNS: readonly RegExp[] = [
  namePattern(["ray", "ruizhi", "liao"]),
  namePattern(["dima", "dmytro", "vremenko"]),
  namePattern(["alex", "alexander", "wilcox"]),
];

/**
 * Returns true if `name` collides with the reserved set: tunnel-specific
 * labels, brand-impersonation labels, the Amplify preview prefixes
 * (`pr-*` / `console-pr-*`), or any Inkbox team-member name pattern.
 *
 * Mirrors `_is_reserved_tunnel_name` in the server source.
 */
export function isReservedName(name: string): boolean {
  if (name.startsWith("console-pr-") || name.startsWith("pr-")) {
    return true;
  }
  if (ALL_RESERVED.has(canonicalize(name, "-"))) {
    return true;
  }
  for (const pattern of TEAM_MEMBER_NAME_PATTERNS) {
    if (pattern.test(name)) return true;
  }
  return false;
}
